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
/** 3-axis acceleration measurement from a MEMS accelerometer */
export interface AccelerometerReading {
    type: "accelerometer";
    sensorId: string;
    timestamp: number;
    ax: number;
    ay: number;
    az: number;
    samplingRateHz: number;
    rangeG: number;
    temperatureC: number;
}
/** Strain gauge measurement — quarter/half/full Wheatstone bridge */
export interface StrainGaugeReading {
    type: "strain_gauge";
    sensorId: string;
    timestamp: number;
    microstrain: number;
    bridgeVoltage: number;
    temperatureC: number;
    gaugeFactor: number;
}
/** Direct displacement measurement (LVDT, laser, or string pot) */
export interface DisplacementReading {
    type: "displacement";
    sensorId: string;
    timestamp: number;
    displacementMm: number;
    rangeMMMin: number;
    rangeMMMax: number;
    temperatureC: number;
}
/** Ambient temperature and humidity — thermal correction */
export interface TemperatureReading {
    type: "temperature";
    sensorId: string;
    timestamp: number;
    temperatureC: number;
    humidityPercent: number;
    pressurePa?: number;
}
/** Union type for any sensor payload arriving from the IoT gateway */
export type SensorReading = AccelerometerReading | StrainGaugeReading | DisplacementReading | TemperatureReading;
/** JSON payload envelope from the PCB IoT gateway (MQTT / HTTP POST) */
export interface SensorPayload {
    gatewayId: string;
    buildingId: string;
    sequenceNumber: number;
    readings: SensorReading[];
    signatureHmac?: string;
}
/** Alert severity levels */
export type AlertLevel = "nominal" | "yellow" | "red" | "critical";
/** Threshold fractions of the allowable drift (Δa) that trigger alerts */
export declare const ALERT_THRESHOLDS: {
    readonly YELLOW: 0.5;
    readonly RED: 0.8;
    readonly CRITICAL: 1;
};
/** Determines alert level from the drift utilization ratio (drift / allowable) */
export declare function classifyAlert(utilizationRatio: number): AlertLevel;
/** Result of double-integration drift estimation */
export interface AccelDriftEstimate {
    samplingRateHz: number;
    sampleCount: number;
    peakVelocityMs: number;
    peakDisplacementMm: number;
    rmsAccelG: number;
    estimatedDriftMm: number;
    warningNote: string;
}
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
export declare function estimateDriftFromAccelerometer(readings: AccelerometerReading[], axis?: "ax" | "ay" | "az"): AccelDriftEstimate;
/** Structured alert message sent to the HiveAgent ecosystem */
export interface ShmAlert {
    alertId: string;
    timestamp: number;
    level: AlertLevel;
    buildingId: string;
    storyLabel: string;
    sensorId: string;
    estimatedDriftMm: number;
    allowableDriftMm: number;
    utilizationRatio: number;
    pheromoneType: string;
    message: string;
    recommendedAction: string;
}
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
export declare function dispatchAlert(buildingId: string, storyLabel: string, sensorId: string, driftMm: number, allowableDriftMm: number): ShmAlert;
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
export declare function ingestSensorPayload(payload: SensorPayload, allowableDriftMm: number, storyLabel: string): ShmAlert[];
//# sourceMappingURL=shm-concept.d.ts.map