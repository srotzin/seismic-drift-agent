"use strict";
/**
 * drift-calculator.ts
 * Seismic Inter-Story Drift Calculator per ASCE 7-22
 *
 * Implements:
 *   - Inter-story drift ratio calculation (§12.8.6)
 *   - Allowable drift limits per Table 12.12-1
 *   - Cd factors by seismic force-resisting system (Table 12.2-1)
 *   - Seismic Design Category (SDC) determination (§11.6, Tables 11.6-1 & 11.6-2)
 *   - P-Delta stability coefficient (§12.8.7)
 *
 * Reference: ASCE/SEI 7-22, Minimum Design Loads and Associated Criteria
 *            for Buildings and Other Structures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEISMIC_SYSTEMS = void 0;
exports.getAllowableDrift = getAllowableDrift;
exports.calculateInterStoryDrift = calculateInterStoryDrift;
exports.getFa = getFa;
exports.getFv = getFv;
exports.determineSDC = determineSDC;
exports.checkPDelta = checkPDelta;
exports.generateStoryReport = generateStoryReport;
// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS: Cd FACTORS — ASCE 7-22 TABLE 12.2-1
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Common seismic force-resisting systems with their Cd deflection
 * amplification factors per ASCE 7-22 Table 12.2-1.
 *
 * Note: Systems with a range (e.g., Ordinary Moment Frames) have
 * material-specific values; consult Table 12.2-1 row by row.
 */
exports.SEISMIC_SYSTEMS = {
    SMRF_STEEL: {
        name: "Special Steel Moment Frame",
        cdMin: 5.5,
        cdMax: 5.5,
        description: "Steel SMRF per AISC 341 — highest ductility class",
    },
    SMRF_CONCRETE: {
        name: "Special Reinforced Concrete Moment Frame",
        cdMin: 5.5,
        cdMax: 5.5,
        description: "RC SMRF per ACI 318 Chapter 18 — highest ductility class",
    },
    IMRF_STEEL: {
        name: "Intermediate Steel Moment Frame",
        cdMin: 4.0,
        cdMax: 4.0,
        description: "Steel IMRF per AISC 341",
    },
    OMRF_STEEL: {
        name: "Ordinary Steel Moment Frame",
        cdMin: 3.0,
        cdMax: 3.0,
        description: "Steel OMRF per AISC 341",
    },
    OMRF_CONCRETE: {
        name: "Ordinary Reinforced Concrete Moment Frame",
        cdMin: 2.5,
        cdMax: 2.5,
        description: "RC OMRF per ACI 318 — limited seismic detailing",
    },
    SPSW_WOOD: {
        name: "Special Wood Shear Wall",
        cdMin: 4.0,
        cdMax: 4.0,
        description: "Wood light-frame shear wall with special detailing per NDS SDPWS",
    },
    OPSW_WOOD: {
        name: "Ordinary Wood Shear Wall",
        cdMin: 2.5,
        cdMax: 2.5,
        description: "Wood light-frame shear wall, conventional construction",
    },
    SPSW_CONCRETE: {
        name: "Special Reinforced Concrete Shear Wall",
        cdMin: 5.0,
        cdMax: 5.0,
        description: "RC special structural walls per ACI 318 Chapter 18",
    },
    OPSW_CONCRETE: {
        name: "Ordinary Reinforced Concrete Shear Wall",
        cdMin: 3.5,
        cdMax: 3.5,
        description: "RC ordinary structural walls per ACI 318",
    },
    BRBF: {
        name: "Buckling-Restrained Braced Frame",
        cdMin: 5.0,
        cdMax: 5.0,
        description: "BRBF per AISC 341 — dual-phase energy dissipation",
    },
    SCBF: {
        name: "Special Concentrically Braced Frame",
        cdMin: 5.0,
        cdMax: 5.0,
        description: "Steel SCBF per AISC 341",
    },
    OCBF: {
        name: "Ordinary Concentrically Braced Frame",
        cdMin: 3.25,
        cdMax: 3.25,
        description: "Steel OCBF per AISC 341",
    },
    SIMPSON_STRONG_WALL: {
        name: "Simpson Strong-Wall (Proprietary Shear Wall)",
        cdMin: 2.5, // Minimum applicable until ESR evaluation is completed
        cdMax: 4.5, // Maximum from current ICC-ES ESR evaluations
        description: "Proprietary wood shear wall per ICC-ES ESR-1799/ESR-2652. " +
            "Actual Cd value must be taken from the current ESR evaluation report " +
            "for the specific product series and configuration.",
    },
};
// ─────────────────────────────────────────────────────────────────────────────
// ALLOWABLE DRIFT LIMITS — ASCE 7-22 TABLE 12.12-1
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns the allowable drift Δa (in inches) per ASCE 7-22 Table 12.12-1.
 *
 * @param hsx          Story height in inches
 * @param riskCategory ASCE 7-22 Risk Category I–IV
 * @param structureType Drives the 0.020 vs 0.025 distinction for RC I/II
 */
function getAllowableDrift(hsx, riskCategory, structureType) {
    switch (riskCategory) {
        case "I":
        case "II":
            // Masonry ≤4 stories gets the relaxed 0.025hsx limit
            if (structureType === "masonry_4stories_or_less") {
                return 0.025 * hsx;
            }
            // Other ≤4-story and all-other structures: 0.020hsx
            return 0.020 * hsx;
        case "III":
            // All structures in RC III: 0.015hsx (Table 12.12-1, Row 3)
            return 0.015 * hsx;
        case "IV":
            // Essential/critical facilities in RC IV: 0.010hsx (Table 12.12-1, Row 4)
            return 0.010 * hsx;
        default:
            throw new Error(`Unknown Risk Category: ${riskCategory}`);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// INTER-STORY DRIFT RATIO CALCULATION — ASCE 7-22 §12.8.6
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Calculates the design inter-story drift and checks it against the
 * ASCE 7-22 Table 12.12-1 allowable limit.
 *
 * Drift amplification:
 *   δx = (Cd × δxe) / Ie          [Eq. 12.8-15]
 *
 * Inter-story drift:
 *   Δ = δx(upper) − δx(lower)
 *
 * When δxe is the relative elastic displacement between floors (i.e., already
 * an inter-story quantity), Δ = δx directly.
 *
 * @param input DriftInput parameters
 * @returns DriftResult with amplified drift, ratio, allowable, and pass/fail
 */
function calculateInterStoryDrift(input) {
    const { deltaE, hsx, cd, ie, riskCategory, structureType } = input;
    if (hsx <= 0)
        throw new Error("Story height hsx must be > 0");
    if (cd <= 0)
        throw new Error("Deflection amplification factor Cd must be > 0");
    if (ie <= 0)
        throw new Error("Importance factor Ie must be > 0");
    if (deltaE < 0)
        throw new Error("Elastic displacement deltaE must be ≥ 0");
    // Amplify the elastic displacement to design level (Eq. 12.8-15)
    const deltaX = (cd * deltaE) / ie;
    // Compute drift ratio (dimensionless)
    const driftRatio = deltaX / hsx;
    // Allowable drift per Table 12.12-1
    const allowableDrift = getAllowableDrift(hsx, riskCategory, structureType);
    const allowableRatio = allowableDrift / hsx;
    // Utilization: 1.0 = exactly at limit; >1.0 = overstress
    const utilizationRatio = driftRatio / allowableRatio;
    const passes = driftRatio <= allowableRatio;
    const summary = `Story drift Δ = ${deltaX.toFixed(3)}" (${(driftRatio * 100).toFixed(3)}% of hsx). ` +
        `Allowable Δa = ${allowableDrift.toFixed(3)}" (${(allowableRatio * 100).toFixed(3)}% of hsx). ` +
        `Utilization = ${(utilizationRatio * 100).toFixed(1)}%. ` +
        (passes ? "PASS ✓" : "FAIL — exceeds ASCE 7-22 Table 12.12-1 limit ✗");
    return { deltaX, driftRatio, allowableDrift, allowableRatio, passes, utilizationRatio, summary };
}
// ─────────────────────────────────────────────────────────────────────────────
// SITE COEFFICIENTS — ASCE 7-22 TABLES 11.4-1 & 11.4-2
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Short-period site coefficient Fa per ASCE 7-22 Table 11.4-1.
 * Ss values bracket: ≤0.25, 0.50, 0.75, 1.00, ≥1.25
 * Linear interpolation applied between break points.
 *
 * Note: Site Class F requires site-specific ground motion analysis.
 */
function getFa(ss, siteClass) {
    if (siteClass === "F") {
        throw new Error("Site Class F requires a site-specific hazard analysis per ASCE 7-22 §21.1");
    }
    // [Ss breakpoint, Fa by site class A, B, C, D, E]
    const table = [
        [0.25, 0.8, 0.9, 1.3, 1.6, 2.4],
        [0.50, 0.8, 0.9, 1.3, 1.4, 1.7],
        [0.75, 0.8, 0.9, 1.2, 1.2, 1.3],
        [1.00, 0.8, 0.9, 1.2, 1.1, 1.0], // E: see ASCE §11.4.4 when Ss≥1.0
        [1.25, 0.8, 0.9, 1.2, 1.0, 0.9],
    ];
    const classIndex = { A: 0, B: 1, C: 2, D: 3, E: 4, F: -1 };
    const col = classIndex[siteClass];
    return interpolateTableValue(ss, table, col);
}
/**
 * Long-period site coefficient Fv per ASCE 7-22 Table 11.4-2.
 * S1 values bracket: ≤0.1, 0.2, 0.3, 0.4, ≥0.5
 */
function getFv(s1, siteClass) {
    if (siteClass === "F") {
        throw new Error("Site Class F requires a site-specific hazard analysis per ASCE 7-22 §21.1");
    }
    // [S1 breakpoint, Fv by site class A, B, C, D, E]
    const table = [
        [0.10, 0.8, 0.8, 1.5, 2.4, 4.2],
        [0.20, 0.8, 0.8, 1.5, 2.2, 3.3],
        [0.30, 0.8, 0.8, 1.5, 2.0, 2.8],
        [0.40, 0.8, 0.8, 1.5, 1.9, 2.4],
        [0.50, 0.8, 0.8, 1.5, 1.8, 2.2],
    ];
    const classIndex = { A: 0, B: 1, C: 2, D: 3, E: 4, F: -1 };
    const col = classIndex[siteClass];
    return interpolateTableValue(s1, table, col);
}
/** Linear interpolation helper for site coefficient tables */
function interpolateTableValue(x, table, col) {
    const n = table.length;
    // Clamp to table bounds
    if (x <= table[0][0])
        return table[0][col + 1];
    if (x >= table[n - 1][0])
        return table[n - 1][col + 1];
    for (let i = 0; i < n - 1; i++) {
        const x0 = table[i][0];
        const x1 = table[i + 1][0];
        if (x >= x0 && x <= x1) {
            const y0 = table[i][col + 1];
            const y1 = table[i + 1][col + 1];
            return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
        }
    }
    throw new Error("Interpolation out of bounds — check input values");
}
// ─────────────────────────────────────────────────────────────────────────────
// SEISMIC DESIGN CATEGORY — ASCE 7-22 §11.6, TABLES 11.6-1 & 11.6-2
// ─────────────────────────────────────────────────────────────────────────────
/** SDC from SDS per ASCE 7-22 Table 11.6-1 */
function sdcFromSds(sds, rc) {
    if (rc === "I" || rc === "II") {
        if (sds < 0.167)
            return "A";
        if (sds < 0.33)
            return "B";
        if (sds < 0.50)
            return "C";
        return "D";
    }
    if (rc === "III") {
        if (sds < 0.167)
            return "A";
        if (sds < 0.33)
            return "B";
        if (sds < 0.50)
            return "C";
        return "D";
    }
    // Risk Category IV
    if (sds < 0.167)
        return "A";
    if (sds < 0.33)
        return "B";
    if (sds < 0.50)
        return "C";
    return "D";
}
/** SDC from SD1 per ASCE 7-22 Table 11.6-2 */
function sdcFromSd1(sd1, rc) {
    if (rc === "I" || rc === "II") {
        if (sd1 < 0.067)
            return "A";
        if (sd1 < 0.133)
            return "B";
        if (sd1 < 0.20)
            return "C";
        return "D";
    }
    if (rc === "III") {
        if (sd1 < 0.067)
            return "A";
        if (sd1 < 0.133)
            return "B";
        if (sd1 < 0.20)
            return "C";
        return "D";
    }
    // Risk Category IV
    if (sd1 < 0.067)
        return "A";
    if (sd1 < 0.133)
        return "B";
    if (sd1 < 0.20)
        return "C";
    return "D";
}
/** Compares two SDC letters and returns the more severe one */
function maxSdc(a, b) {
    const order = ["A", "B", "C", "D", "E", "F"];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
/**
 * Determines the Seismic Design Category per ASCE 7-22 §11.6.
 *
 * Procedure:
 *   1. Look up site coefficients Fa, Fv from Tables 11.4-1 & 11.4-2
 *   2. Compute adjusted MCE accelerations: SMS, SM1
 *   3. Compute design accelerations: SDS = (2/3)SMS,  SD1 = (2/3)SM1
 *   4. Read SDC from Tables 11.6-1 (SDS-based) and 11.6-2 (SD1-based)
 *   5. Governing SDC = the more severe of the two
 *
 * Special rule: S1 ≥ 0.75 g → SDC E (RC I, II, III) or SDC F (RC IV)
 *
 * @param input SdcInput with Ss, S1, site class, and risk category
 */
function determineSDC(input) {
    const { ss, s1, siteClass, riskCategory } = input;
    // Special rule for high S1 regions (§11.6)
    if (s1 >= 0.75) {
        const sdc = riskCategory === "IV" ? "F" : "E";
        const fa = getFa(ss, siteClass);
        const fv = getFv(s1, siteClass);
        const sms = fa * ss;
        const sm1 = fv * s1;
        const sds = (2 / 3) * sms;
        const sd1 = (2 / 3) * sm1;
        return {
            fa, fv, sms, sm1, sds, sd1,
            sdcFromSds: sdc,
            sdcFromSd1: sdc,
            sdc,
            summary: `S1 = ${s1} ≥ 0.75 g → SDC ${sdc} per ASCE 7-22 §11.6 special rule. ` +
                `SDS = ${sds.toFixed(3)} g,  SD1 = ${sd1.toFixed(3)} g.`,
        };
    }
    const fa = getFa(ss, siteClass);
    const fv = getFv(s1, siteClass);
    const sms = fa * ss;
    const sm1 = fv * s1;
    const sds = (2 / 3) * sms;
    const sd1 = (2 / 3) * sm1;
    const sdcSds = sdcFromSds(sds, riskCategory);
    const sdcSd1 = sdcFromSd1(sd1, riskCategory);
    const sdc = maxSdc(sdcSds, sdcSd1);
    const summary = `Fa=${fa.toFixed(2)}, Fv=${fv.toFixed(2)} → ` +
        `SMS=${sms.toFixed(3)}g, SM1=${sm1.toFixed(3)}g → ` +
        `SDS=${sds.toFixed(3)}g, SD1=${sd1.toFixed(3)}g. ` +
        `SDC from SDS: ${sdcSds}, SDC from SD1: ${sdcSd1}. ` +
        `Governing SDC: ${sdc}`;
    return { fa, fv, sms, sm1, sds, sd1, sdcFromSds: sdcSds, sdcFromSd1: sdcSd1, sdc, summary };
}
// ─────────────────────────────────────────────────────────────────────────────
// P-DELTA STABILITY CHECK — ASCE 7-22 §12.8.7
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Checks the P-Delta stability coefficient θ per ASCE 7-22 §12.8.7.
 *
 * θ = (Px × Δ × Ie) / (Vx × hsx × Cd)         [Eq. 12.8-16]
 *
 * Rules:
 *   θ ≤ 0.10  → P-Delta effects may be neglected
 *   θ > 0.10  → Second-order (P-Delta) analysis required
 *   θ > θmax  → Structure is potentially unstable; redesign required
 *
 * θmax = 0.5 / (β × Cd) ≤ 0.25                  [Eq. 12.8-17]
 *
 * @param input PDeltaInput parameters
 */
function checkPDelta(input) {
    const { px, delta, ie, vx, hsx, cd, beta = 1.0 } = input;
    if (vx <= 0)
        throw new Error("Story shear Vx must be > 0");
    if (hsx <= 0)
        throw new Error("Story height hsx must be > 0");
    if (cd <= 0)
        throw new Error("Cd must be > 0");
    // Stability coefficient (Eq. 12.8-16)
    const theta = (px * delta * ie) / (vx * hsx * cd);
    // Maximum permitted stability coefficient (Eq. 12.8-17), capped at 0.25
    const thetaMaxRaw = 0.5 / (beta * cd);
    const thetaMax = Math.min(thetaMaxRaw, 0.25);
    const requiresPDeltaAnalysis = theta > 0.10;
    const structurallyUnstable = theta > thetaMax;
    let summary;
    if (!requiresPDeltaAnalysis) {
        summary = `θ = ${theta.toFixed(4)} ≤ 0.10 — P-Delta effects negligible per ASCE 7-22 §12.8.7. ✓`;
    }
    else if (!structurallyUnstable) {
        summary =
            `θ = ${theta.toFixed(4)} > 0.10 — P-Delta analysis REQUIRED per ASCE 7-22 §12.8.7. ` +
                `θmax = ${thetaMax.toFixed(4)}. Structure is stable (θ < θmax). ⚠`;
    }
    else {
        summary =
            `θ = ${theta.toFixed(4)} > θmax = ${thetaMax.toFixed(4)} — ` +
                `STRUCTURE MAY BE UNSTABLE per ASCE 7-22 §12.8.7 Eq. 12.8-17. Redesign required. ✗`;
    }
    return { theta, thetaMax, requiresPDeltaAnalysis, structurallyUnstable, summary };
}
/**
 * Generates a complete drift and optional P-Delta report for a single story.
 *
 * @param label     Human-readable story label (e.g. "Story 3")
 * @param drift     DriftInput parameters
 * @param pDelta    Optional PDeltaInput parameters (omit if P-Delta check not needed)
 */
function generateStoryReport(label, drift, pDelta) {
    const driftResult = calculateInterStoryDrift(drift);
    const pDeltaResult = pDelta ? checkPDelta(pDelta) : undefined;
    return {
        storyLabel: label,
        drift: driftResult,
        pDelta: pDeltaResult,
    };
}
//# sourceMappingURL=drift-calculator.js.map