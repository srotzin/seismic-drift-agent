/**
 * shm-concept.ts
 * Structural Health Monitoring (SHM) — Concept Module
 *
 * Defines the data types, ingestion interface, drift estimation pipeline,
 * and alert dispatch logic for integrating PCB-based IoT sensors with the
 * Quake-Drift-Sentinel HiveForge agent.
 *
 * Data flow:
 *   PCB Sensor  →  IoT Gateway  →  SHM Ingestor  →  Drift Estimator  →  Alert Dispatcher  →  HiveAgent Ecosystem
 *
 * Sensor hardware concept:
 *   - MEMS accelerometer (3-axis, e.g. ADXL355 or ICM-42688-P) on a custom PCB
 *   - Strain gauges (Wheatstone bridge configuration)
 *   - LVDT or laser displacement sensors
 *   - Temperature/humidity (BME280) for thermal compensation
 *   - Edge processor (Raspberry Pi Compute Module / ESP32-S3) handles sampling
 *   - Data transmitted to IoT gateway via MQTT over TLS
 */

// ─────────────────────────────────────────────────────────────────────────────
// SENSOR DATA TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** 3-axis acceleration measurement from a MEMS accelerometer */
export interface AccelerometerReading {
  type: "accelerometer";
  sensorId: string;           // Unique sensor identifier (e.g. "ACC-FLOOR3-NE")
  timestamp: number;          // Unix epoch milliseconds (UTC)
  ax: number;                 // Acceleration, X-axis (g)
  ay: number;                 // Acceleration, Y-axis (g)
  az: number;                 // Acceleration, Z-axis (g, includes gravity when not zeroed)
  samplingRateHz: number;     // Actual sampling rate at time of reading
  rangeG: number;             // Full-scale range (e.g. 8 for ±8g)
  temperatureC: number;       // Die temperature for drift compensation (°C)
}

/** Strain gauge measurement — quarter/half/full Wheatstone bridge */
export interface StrainGaugeReading {
  type: "strain_gauge";
  sensorId: string;
  timestamp: number;          // Unix epoch milliseconds (UTC)
  microstrain: number;        // Strain in με (microstrains; 1 με = 1e-6 m/m)
  bridgeVoltage: number;      // Excitation voltage (V)
  temperatureC: number;       // For thermal compensation
  gaugeFactor: number;        // Sensor gauge factor (dimensionless, typically ~2.0)
}

/** Direct displacement measurement (LVDT, laser, or string pot) */
export interface DisplacementReading {
  type: "displacement";
  sensorId: string;
  timestamp: number;          // Unix epoch milliseconds (UTC)
  displacementMm: number;     // Measured displacement (mm), signed (+ = positive direction)
  rangeMMMin: number;         // Sensor minimum range (mm)
  rangeMMMax: number;         // Sensor maximum range (mm)
  temperatureC: number;
}

/** Ambient temperature and humidity — thermal correction */
export interface TemperatureReading {
  type: "temperature";
  sensorId: string;
  timestamp: number;
  temperatureC: number;
  humidityPercent: number;
  pressurePa?: number;        // Optional barometric pressure
}

/** Union type for any sensor payload arriving from the IoT gateway */
export type SensorReading =
  | AccelerometerReading
  | StrainGaugeReading
  | DisplacementReading
  | TemperatureReading;

/** JSON payload envelope from the PCB IoT gateway (MQTT / HTTP POST) */
export interface SensorPayload {
  gatewayId: string;          // Gateway identifier (maps to building + location)
  buildingId: string;         // Building identifier (used to look up ASCE 7 parameters)
  sequenceNumber: number;     // Monotonically increasing; gaps = packet loss
  readings: SensorReading[];  // One or more sensor readings in this batch
  signatureHmac?: string;     // Optional HMAC-SHA256 for payload integrity verification
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

/** Alert severity levels */
export type AlertLevel = "nominal" | "yellow" | "red" | "critical";

/** Threshold fractions of the allowable drift (Δa) that trigger alerts */
export const ALERT_THRESHOLDS = {
  YELLOW:   0.50,  // ≥50% of allowable drift  — early warning, log and notify
  RED:      0.80,  // ≥80% of allowable drift  — escalate to structural team
  CRITICAL: 1.00,  // ≥100% of allowable drift — code violation, immediate action
} as const;

/** Determines alert level from the drift utilization ratio (drift / allowable) */
export function classifyAlert(utilizationRatio: number): AlertLevel {
  if (utilizationRatio >= ALERT_THRESHOLDS.CRITICAL) return "critical";
  if (utilizationRatio >= ALERT_THRESHOLDS.RED)      return "red";
  if (utilizationRatio >= ALERT_THRESHOLDS.YELLOW)   return "yellow";
  return "nominal";
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT ESTIMATION FROM ACCELEROMETER DATA
// Double-integration with baseline correction per Boore (2005) convention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes the mean (DC offset) from an acceleration time series.
 * Essential before integration to prevent velocity / displacement drift.
 *
 * @param accelSeries Array of acceleration values (g or m/s²)
 */
function removeMean(accelSeries: number[]): number[] {
  const mean = accelSeries.reduce((s, v) => s + v, 0) / accelSeries.length;
  return accelSeries.map((v) => v - mean);
}

/**
 * Numerically integrates an array of values using the trapezoidal rule.
 *
 * @param values  Input series
 * @param dt      Time step in seconds (1 / samplingRateHz)
 */
function trapezoidalIntegrate(values: number[], dt: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  for (let i = 1; i < values.length; i++) {
    result[i] = result[i - 1] + 0.5 * (values[i - 1] + values[i]) * dt;
  }
  return result;
}

/**
 * Fits and removes a linear trend (baseline drift) from an integrated series.
 * This baseline correction prevents cumulative integration error from causing
 * unrealistic long-period displacement offsets.
 */
function detrend(series: number[]): number[] {
  const n = series.length;
  if (n < 2) return series;

  // Least-squares linear fit: y = a + b*i
  const sumI  = (n * (n - 1)) / 2;
  const sumI2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY  = series.reduce((s, v) => s + v, 0);
  const sumIY = series.reduce((s, v, i) => s + i * v, 0);

  const denom = n * sumI2 - sumI * sumI;
  const b = (n * sumIY - sumI * sumY) / denom;
  const a = (sumY - b * sumI) / n;

  return series.map((v, i) => v - (a + b * i));
}

/** Result of double-integration drift estimation */
export interface AccelDriftEstimate {
  samplingRateHz: number;
  sampleCount: number;
  peakVelocityMs: number;           // Peak velocity (m/s)
  peakDisplacementMm: number;       // Peak displacement (mm)
  rmsAccelG: number;                // RMS of input acceleration (g)
  estimatedDriftMm: number;         // Inter-story drift estimate (mm)
  warningNote: string;              // Caveats about estimation accuracy
}

/** 1g in m/s² */
const G_MS2 = 9.80665;

/**
 * Estimates inter-story drift from a window of 3-axis accelerometer readings
 * via double integration with baseline correction.
 *
 * Process:
 *   1. Convert acceleration to m/s²
 *   2. Remove gravity component from Z-axis (if raw reading)
 *   3. Mean-removal (DC baseline subtraction)
 *   4. Trapezoidal integration → velocity
 *   5. Detrend velocity
 *   6. Trapezoidal integration → displacement
 *   7. Detrend displacement
 *   8. Peak displacement = estimated drift
 *
 * IMPORTANT CAVEATS:
 *   - Double integration accumulates numerical error; suitable for real-time
 *     alerting but should not replace LVDT or GPS-RTK measurements for
 *     structural assessment.
 *   - The window length should capture the dominant building period (T) with
 *     a minimum of 10 × T seconds.
 *   - Frequency-domain baseline correction (high-pass filter) is preferred
 *     for post-event analysis (Boore & Bommer, 2005).
 *
 * @param readings   Window of AccelerometerReadings (all from same sensor, same floor)
 * @param axis       Axis to process: "ax" | "ay" | "az"
 */
export function estimateDriftFromAccelerometer(
  readings: AccelerometerReading[],
  axis: "ax" | "ay" | "az" = "ax"
): AccelDriftEstimate {
  if (readings.length < 2) {
    throw new Error("Need at least 2 readings to estimate drift");
  }

  const hz = readings[0].samplingRateHz;
  const dt = 1.0 / hz;

  // Extract and convert to m/s²
  const rawG     = readings.map((r) => r[axis]);
  const rmsG     = Math.sqrt(rawG.reduce((s, v) => s + v * v, 0) / rawG.length);
  const accelMs2 = rawG.map((g) => g * G_MS2);

  // Step 1: remove mean acceleration (static offset removal)
  const accelCorrected = removeMean(accelMs2);

  // Step 2: integrate → velocity (m/s)
  const velocityRaw = trapezoidalIntegrate(accelCorrected, dt);

  // Step 3: detrend velocity (linear baseline correction)
  const velocityDetrended = detrend(velocityRaw);

  // Step 4: integrate → displacement (m)
  const dispRaw = trapezoidalIntegrate(velocityDetrended, dt);

  // Step 5: detrend displacement
  const dispDetrended = detrend(dispRaw);

  // Step 6: peak values
  const peakVelocityMs     = Math.max(...velocityDetrended.map(Math.abs));
  const peakDisplacementM  = Math.max(...dispDetrended.map(Math.abs));
  const peakDisplacementMm = peakDisplacementM * 1000;

  return {
    samplingRateHz: hz,
    sampleCount: readings.length,
    peakVelocityMs,
    peakDisplacementMm,
    rmsAccelG: rmsG,
    estimatedDriftMm: peakDisplacementMm,
    warningNote:
      "Double-integration estimate; subject to low-frequency error accumulation. " +
      "Confirm with direct displacement sensors for structural assessment.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT DISPATCH — HIVEAGENT ECOSYSTEM INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

/** Structured alert message sent to the HiveAgent ecosystem */
export interface ShmAlert {
  alertId: string;            // UUID for deduplication
  timestamp: number;          // Unix epoch milliseconds
  level: AlertLevel;
  buildingId: string;
  storyLabel: string;
  sensorId: string;
  estimatedDriftMm: number;
  allowableDriftMm: number;
  utilizationRatio: number;   // Fraction: >1.0 means code exceedance
  pheromoneType: string;      // HiveForge pheromone label
  message: string;
  recommendedAction: string;
}

/** Maps alert level to HiveForge pheromone emission type */
const PHEROMONE_MAP: Record<AlertLevel, string> = {
  nominal:  "nominal_heartbeat",
  yellow:   "drift_warning",
  red:      "drift_alert",
  critical: "sensor_anomaly",
};

/** Recommended engineering actions per alert level */
const ACTION_MAP: Record<AlertLevel, string> = {
  nominal:  "No action required. Log and continue monitoring.",
  yellow:   "Notify structural engineer of record. Review sensor trend data. Schedule inspection if sustained.",
  red:      "Alert structural engineer immediately. Evacuate non-essential personnel. Initiate damage inspection.",
  critical:
    "IMMEDIATE EVACUATION. Contact structural engineer and local building authority. " +
    "Do not re-occupy until structural assessment is complete.",
};

/**
 * Builds an ShmAlert and dispatches it to the HiveAgent ecosystem.
 *
 * In production this would POST to the HiveForge /v1/pheromones or
 * /v1/alerts endpoint. In this concept module it returns the alert object
 * and logs to console.
 *
 * @param buildingId        Building identifier
 * @param storyLabel        Story label (e.g., "Level 4")
 * @param sensorId          Originating sensor ID
 * @param driftMm           Estimated or measured drift in mm
 * @param allowableDriftMm  Allowable drift Δa in mm (from drift calculator)
 */
export function dispatchAlert(
  buildingId: string,
  storyLabel: string,
  sensorId: string,
  driftMm: number,
  allowableDriftMm: number
): ShmAlert {
  const utilizationRatio = driftMm / allowableDriftMm;
  const level = classifyAlert(utilizationRatio);

  const alert: ShmAlert = {
    alertId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    buildingId,
    storyLabel,
    sensorId,
    estimatedDriftMm: driftMm,
    allowableDriftMm,
    utilizationRatio,
    pheromoneType: PHEROMONE_MAP[level],
    message:
      `[${level.toUpperCase()}] ${buildingId} ${storyLabel}: ` +
      `Drift = ${driftMm.toFixed(2)} mm (${(utilizationRatio * 100).toFixed(1)}% of allowable ${allowableDriftMm.toFixed(2)} mm)`,
    recommendedAction: ACTION_MAP[level],
  };

  // In production: await axios.post(`${process.env.HIVEFORGE_API_URL}/v1/alerts`, alert, { headers: { Authorization: `Bearer ${process.env.HIVEFORGE_API_KEY}` } });
  console.log(`[SHM ALERT] ${alert.message}`);
  console.log(`[SHM ACTION] ${alert.recommendedAction}`);

  return alert;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN INGESTION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes an incoming SensorPayload from the IoT gateway.
 *
 * For accelerometer readings:
 *   - Groups readings by sensorId
 *   - Runs double-integration drift estimation
 *   - Compares against a provided allowable drift
 *   - Dispatches alerts as needed
 *
 * @param payload          SensorPayload from IoT gateway
 * @param allowableDriftMm Allowable drift (mm) for this building/story (from drift-calculator)
 * @param storyLabel       Story label for alert context
 */
export function ingestSensorPayload(
  payload: SensorPayload,
  allowableDriftMm: number,
  storyLabel: string
): ShmAlert[] {
  const alerts: ShmAlert[] = [];

  // Group accelerometer readings by sensorId
  const accelMap = new Map<string, AccelerometerReading[]>();
  for (const reading of payload.readings) {
    if (reading.type === "accelerometer") {
      const existing = accelMap.get(reading.sensorId) ?? [];
      existing.push(reading as AccelerometerReading);
      accelMap.set(reading.sensorId, existing);
    }
  }

  for (const [sensorId, readings] of accelMap) {
    // Sort by timestamp to ensure correct integration order
    readings.sort((a, b) => a.timestamp - b.timestamp);

    if (readings.length < 10) {
      // Need a meaningful window; skip if too few samples
      console.warn(`[SHM] Sensor ${sensorId}: insufficient samples (${readings.length}) for drift estimation`);
      continue;
    }

    // Estimate drift on dominant horizontal axis (ax)
    const estimate = estimateDriftFromAccelerometer(readings, "ax");

    // Dispatch alert if above yellow threshold
    if (estimate.estimatedDriftMm >= ALERT_THRESHOLDS.YELLOW * allowableDriftMm) {
      const alert = dispatchAlert(
        payload.buildingId,
        storyLabel,
        sensorId,
        estimate.estimatedDriftMm,
        allowableDriftMm
      );
      alerts.push(alert);
    }
  }

  return alerts;
}
