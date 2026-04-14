"use strict";
/**
 * index.ts
 * Quake-Drift-Sentinel — Entry Point
 *
 * Demonstrates drift calculation, SDC determination, P-Delta check,
 * and SHM ingestion pipeline with representative example values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const drift_calculator_1 = require("./drift-calculator");
const shm_concept_1 = require("./shm-concept");
// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 1: SDC Determination for a Site in Los Angeles
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════");
console.log("  QUAKE-DRIFT-SENTINEL — Seismic Drift Calculator v1.0");
console.log("══════════════════════════════════════════════════════════\n");
const sdcInput = {
    ss: 1.50, // g — typical for Los Angeles (USGS NSHM 2018)
    s1: 0.60, // g
    siteClass: "D", // Stiff soil — most common default per ASCE 7-22 §20.3
    riskCategory: "II", // Standard occupancy
};
console.log("── SDC Determination (ASCE 7-22 §11.6) ──────────────────");
console.log("Input:", sdcInput);
const sdcResult = (0, drift_calculator_1.determineSDC)(sdcInput);
console.log("Result:", sdcResult.summary);
// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 2: Inter-Story Drift for a 12-Story Steel SMRF
// ─────────────────────────────────────────────────────────────────────────────
const system = drift_calculator_1.SEISMIC_SYSTEMS["SMRF_STEEL"];
const storyHeightIn = 13 * 12; // 13 ft = 156 inches
const elasticDriftIn = 0.50; // 0.50" elastic inter-story displacement from analysis
const driftInput = {
    deltaE: elasticDriftIn,
    hsx: storyHeightIn,
    cd: system.cdMax, // 5.5 for Special Steel Moment Frame
    ie: 1.0, // Risk Category II → Ie = 1.0
    riskCategory: "II",
    structureType: "all_other",
};
console.log("\n── Inter-Story Drift (ASCE 7-22 §12.8.6) ────────────────");
console.log(`System: ${system.name} (Cd = ${system.cdMax})`);
console.log(`Story height: ${storyHeightIn}" (${storyHeightIn / 12} ft)`);
console.log(`Elastic displacement: ${elasticDriftIn}"`);
const driftResult = (0, drift_calculator_1.calculateInterStoryDrift)(driftInput);
console.log("Result:", driftResult.summary);
// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 3: P-Delta Stability Check
// ─────────────────────────────────────────────────────────────────────────────
const pDeltaInput = {
    px: 4500, // kips — total vertical load above this story
    delta: driftResult.deltaX, // amplified story drift (inches)
    ie: 1.0,
    vx: 350, // kips — seismic story shear
    hsx: storyHeightIn,
    cd: system.cdMax,
    beta: 1.0, // Conservative (shear demand = shear capacity)
};
console.log("\n── P-Delta Stability (ASCE 7-22 §12.8.7) ────────────────");
const pDeltaResult = (0, drift_calculator_1.checkPDelta)(pDeltaInput);
console.log("Result:", pDeltaResult.summary);
// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 4: Full Story Report
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Full Story Report ─────────────────────────────────────");
const report = (0, drift_calculator_1.generateStoryReport)("Story 6 (12-Story SMRF)", driftInput, pDeltaInput);
console.log(`Story: ${report.storyLabel}`);
console.log(`Drift: ${report.drift.summary}`);
if (report.pDelta) {
    console.log(`P-Delta: ${report.pDelta.summary}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 5: SHM Sensor Payload Ingestion
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── SHM Sensor Payload Ingestion ──────────────────────────");
// Simulate 1 second of accelerometer data at 100 Hz (100 samples)
const now = Date.now();
const mockReadings = Array.from({ length: 100 }, (_, i) => ({
    type: "accelerometer",
    sensorId: "ACC-FLOOR6-NE",
    timestamp: now + i * 10, // 10 ms apart = 100 Hz
    ax: 0.02 * Math.sin(2 * Math.PI * 0.5 * (i / 100)), // 0.5 Hz sinusoid, 0.02g peak
    ay: 0.01 * Math.cos(2 * Math.PI * 0.5 * (i / 100)),
    az: 1.0, // Z-axis includes gravity (1g static)
    samplingRateHz: 100,
    rangeG: 8,
    temperatureC: 22.5,
}));
const mockPayload = {
    gatewayId: "GW-BLDG-A-FLOOR6",
    buildingId: "BLDG-A",
    sequenceNumber: 4872,
    readings: mockReadings,
};
// Allowable drift in mm for this story (from drift calculation, converted)
const allowableDriftMm = driftResult.allowableDrift * 25.4; // inches → mm
const alerts = (0, shm_concept_1.ingestSensorPayload)(mockPayload, allowableDriftMm, "Story 6");
if (alerts.length === 0) {
    console.log("SHM: No alerts generated — drift within nominal range.");
}
else {
    console.log(`SHM: ${alerts.length} alert(s) generated.`);
    alerts.forEach((a) => {
        console.log(`  [${a.level.toUpperCase()}] ${a.message}`);
        console.log(`  Action: ${a.recommendedAction}`);
    });
}
console.log("\n══════════════════════════════════════════════════════════");
console.log("  Quake-Drift-Sentinel online. Building codes enforced.");
console.log("══════════════════════════════════════════════════════════\n");
//# sourceMappingURL=index.js.map