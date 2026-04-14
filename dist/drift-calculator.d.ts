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
/** ASCE 7-22 Risk Categories (§1.5) */
export type RiskCategory = "I" | "II" | "III" | "IV";
/** ASCE 7-22 Site Classes (§20.2) */
export type SiteClass = "A" | "B" | "C" | "D" | "E" | "F";
/** ASCE 7-22 Seismic Design Categories (§11.6) */
export type SDC = "A" | "B" | "C" | "D" | "E" | "F";
/** Building structure types for drift limit selection (Table 12.12-1) */
export type StructureType = "masonry_4stories_or_less" | "other_4stories_or_less" | "masonry_general" | "all_other";
/** Seismic force-resisting systems with their Cd values per ASCE 7-22 Table 12.2-1 */
export interface SeismicSystem {
    name: string;
    cdMin: number;
    cdMax: number;
    description: string;
}
/** Input parameters for inter-story drift ratio calculation */
export interface DriftInput {
    deltaE: number;
    hsx: number;
    cd: number;
    ie: number;
    riskCategory: RiskCategory;
    structureType: StructureType;
}
/** Result of an inter-story drift calculation */
export interface DriftResult {
    deltaX: number;
    driftRatio: number;
    allowableDrift: number;
    allowableRatio: number;
    passes: boolean;
    utilizationRatio: number;
    summary: string;
}
/** Input parameters for SDC determination */
export interface SdcInput {
    ss: number;
    s1: number;
    siteClass: SiteClass;
    riskCategory: RiskCategory;
}
/** Spectral accelerations and SDC result */
export interface SdcResult {
    fa: number;
    fv: number;
    sms: number;
    sm1: number;
    sds: number;
    sd1: number;
    sdcFromSds: SDC;
    sdcFromSd1: SDC;
    sdc: SDC;
    summary: string;
}
/** Input for P-Delta stability check */
export interface PDeltaInput {
    px: number;
    delta: number;
    ie: number;
    vx: number;
    hsx: number;
    cd: number;
    beta?: number;
}
/** P-Delta stability coefficient result */
export interface PDeltaResult {
    theta: number;
    thetaMax: number;
    requiresPDeltaAnalysis: boolean;
    structurallyUnstable: boolean;
    summary: string;
}
/**
 * Common seismic force-resisting systems with their Cd deflection
 * amplification factors per ASCE 7-22 Table 12.2-1.
 *
 * Note: Systems with a range (e.g., Ordinary Moment Frames) have
 * material-specific values; consult Table 12.2-1 row by row.
 */
export declare const SEISMIC_SYSTEMS: Record<string, SeismicSystem>;
/**
 * Returns the allowable drift Δa (in inches) per ASCE 7-22 Table 12.12-1.
 *
 * @param hsx          Story height in inches
 * @param riskCategory ASCE 7-22 Risk Category I–IV
 * @param structureType Drives the 0.020 vs 0.025 distinction for RC I/II
 */
export declare function getAllowableDrift(hsx: number, riskCategory: RiskCategory, structureType: StructureType): number;
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
export declare function calculateInterStoryDrift(input: DriftInput): DriftResult;
/**
 * Short-period site coefficient Fa per ASCE 7-22 Table 11.4-1.
 * Ss values bracket: ≤0.25, 0.50, 0.75, 1.00, ≥1.25
 * Linear interpolation applied between break points.
 *
 * Note: Site Class F requires site-specific ground motion analysis.
 */
export declare function getFa(ss: number, siteClass: SiteClass): number;
/**
 * Long-period site coefficient Fv per ASCE 7-22 Table 11.4-2.
 * S1 values bracket: ≤0.1, 0.2, 0.3, 0.4, ≥0.5
 */
export declare function getFv(s1: number, siteClass: SiteClass): number;
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
export declare function determineSDC(input: SdcInput): SdcResult;
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
export declare function checkPDelta(input: PDeltaInput): PDeltaResult;
export interface StoryReport {
    storyLabel: string;
    drift: DriftResult;
    pDelta?: PDeltaResult;
}
/**
 * Generates a complete drift and optional P-Delta report for a single story.
 *
 * @param label     Human-readable story label (e.g. "Story 3")
 * @param drift     DriftInput parameters
 * @param pDelta    Optional PDeltaInput parameters (omit if P-Delta check not needed)
 */
export declare function generateStoryReport(label: string, drift: DriftInput, pDelta?: PDeltaInput): StoryReport;
//# sourceMappingURL=drift-calculator.d.ts.map