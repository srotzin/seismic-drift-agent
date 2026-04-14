"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALERT_THRESHOLDS = void 0;
exports.classifyAlert = classifyAlert;
exports.estimateDriftFromAccelerometer = estimateDriftFromAccelerometer;
exports.dispatchAlert = dispatchAlert;
exports.ingestSensorPayload = ingestSensorPayload;
/** Threshold fractions of the allowable drift (Δa) that trigger alerts */
exports.ALERT_THRESHOLDS = {
    YELLOW: 0.50, // ≥50% of allowable drift  — early warning, log and notify
    RED: 0.80, // ≥80% of allowable drift  — escalate to structural team
    CRITICAL: 1.00, // ≥100% of allowable drift — code violation, immediate action
};
/** Determines alert level from the drift utilization ratio (drift / allowable) */
function classifyAlert(utilizationRatio) {
    if (utilizationRatio >= exports.ALERT_THRESHOLDS.CRITICAL)
        return "critical";
    if (utilizationRatio >= exports.ALERT_THRESHOLDS.RED)
        return "red";
    if (utilizationRatio >= exports.ALERT_THRESHOLDS.YELLOW)
        return "yellow";
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
function removeMean(accelSeries) {
    const mean = accelSeries.reduce((s, v) => s + v, 0) / accelSeries.length;
    return accelSeries.map((v) => v - mean);
}
/**
 * Numerically integrates an array of values using the trapezoidal rule.
 *
 * @param values  Input series
 * @param dt      Time step in seconds (1 / samplingRateHz)
 */
function trapezoidalIntegrate(values, dt) {
    const result = new Array(values.length).fill(0);
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
function detrend(series) {
    const n = series.length;
    if (n < 2)
        return series;
    // Least-squares linear fit: y = a + b*i
    const sumI = (n * (n - 1)) / 2;
    const sumI2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY = series.reduce((s, v) => s + v, 0);
    const sumIY = series.reduce((s, v, i) => s + i * v, 0);
    const denom = n * sumI2 - sumI * sumI;
    const b = (n * sumIY - sumI * sumY) / denom;
    const a = (sumY - b * sumI) / n;
    return series.map((v, i) => v - (a + b * i));
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
function estimateDriftFromAccelerometer(readings, axis = "ax") {
    if (readings.length < 2) {
        throw new Error("Need at least 2 readings to estimate drift");
    }
    const hz = readings[0].samplingRateHz;
    const dt = 1.0 / hz;
    // Extract and convert to m/s²
    const rawG = readings.map((r) => r[axis]);
    const rmsG = Math.sqrt(rawG.reduce((s, v) => s + v * v, 0) / rawG.length);
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
    const peakVelocityMs = Math.max(...velocityDetrended.map(Math.abs));
    const peakDisplacementM = Math.max(...dispDetrended.map(Math.abs));
    const peakDisplacementMm = peakDisplacementM * 1000;
    return {
        samplingRateHz: hz,
        sampleCount: readings.length,
        peakVelocityMs,
        peakDisplacementMm,
        rmsAccelG: rmsG,
        estimatedDriftMm: peakDisplacementMm,
        warningNote: "Double-integration estimate; subject to low-frequency error accumulation. " +
            "Confirm with direct displacement sensors for structural assessment.",
    };
}
/** Maps alert level to HiveForge pheromone emission type */
const PHEROMONE_MAP = {
    nominal: "nominal_heartbeat",
    yellow: "drift_warning",
    red: "drift_alert",
    critical: "sensor_anomaly",
};
/** Recommended engineering actions per alert level */
const ACTION_MAP = {
    nominal: "No action required. Log and continue monitoring.",
    yellow: "Notify structural engineer of record. Review sensor trend data. Schedule inspection if sustained.",
    red: "Alert structural engineer immediately. Evacuate non-essential personnel. Initiate damage inspection.",
    critical: "IMMEDIATE EVACUATION. Contact structural engineer and local building authority. " +
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
function dispatchAlert(buildingId, storyLabel, sensorId, driftMm, allowableDriftMm) {
    const utilizationRatio = driftMm / allowableDriftMm;
    const level = classifyAlert(utilizationRatio);
    const alert = {
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
        message: `[${level.toUpperCase()}] ${buildingId} ${storyLabel}: ` +
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
function ingestSensorPayload(payload, allowableDriftMm, storyLabel) {
    const alerts = [];
    // Group accelerometer readings by sensorId
    const accelMap = new Map();
    for (const reading of payload.readings) {
        if (reading.type === "accelerometer") {
            const existing = accelMap.get(reading.sensorId) ?? [];
            existing.push(reading);
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
        if (estimate.estimatedDriftMm >= exports.ALERT_THRESHOLDS.YELLOW * allowableDriftMm) {
            const alert = dispatchAlert(payload.buildingId, storyLabel, sensorId, estimate.estimatedDriftMm, allowableDriftMm);
            alerts.push(alert);
        }
    }
    return alerts;
}
//# sourceMappingURL=shm-concept.js.map