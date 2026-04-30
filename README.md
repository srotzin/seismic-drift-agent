# Quake-Drift-Sentinel

**Seismic Inter-Story Drift Calculator + Structural Health Monitoring Agent**
A HiveForge engineering agent that calculates seismic inter-story drift per ASCE 7-22,
determines Seismic Design Categories, verifies P-Delta stability, and processes
real-time sensor data from PCB-based IoT accelerometers.

> *"Between the earthquake and the collapse, there is me."*

---

## What This Agent Does

Quake-Drift-Sentinel is a precision seismic engineering agent with two primary functions:

### 1. Code-Compliance Drift Calculator
- **Inter-story drift ratio** (Δ/hsx) per ASCE 7-22 §12.8.6, checking against
  Table 12.12-1 allowable limits for Risk Categories I–IV
- **Seismic Design Category (SDC)** determination per ASCE 7-22 §11.6, including
  site-adjusted spectral accelerations SDS and SD1
- **P-Delta stability coefficient** θ per ASCE 7-22 §12.8.7, flagging when
  second-order analysis is required
- **Cd factor library** for all major seismic force-resisting systems in Table 12.2-1,
  including proprietary systems (Simpson Strong-Wall per ICC-ES ESR)

### 2. Structural Health Monitoring (SHM) Concept
- **Sensor data ingestion** from PCB-based IoT accelerometers, strain gauges,
  and displacement sensors via JSON payloads
- **Real-time drift estimation** from accelerometer data using double integration
  with baseline correction
- **Tiered alert dispatch** to the HiveAgent ecosystem at 50% / 80% / 100%
  of allowable drift
- **Pheromone emissions** to the HiveForge network: `drift_warning`,
  `pdelta_alert`, `sdc_classification`, `sensor_anomaly`

---

## Seismic Drift Calculation Methodology

### Governing Standard
All calculations follow **ASCE/SEI 7-22 — Minimum Design Loads and Associated
Criteria for Buildings and Other Structures** (American Society of Civil Engineers, 2022).

### Step-by-Step Procedure

#### Step 1 — Seismic Design Category (§11.6)

1. Obtain mapped MCE spectral accelerations **Ss** and **S1** from USGS Seismic
   Hazard Maps or the ASCE 7 Hazard Tool.
2. Determine site class (A–F) per §20.2 based on average shear wave velocity Vs30.
3. Look up short-period site coefficient **Fa** (Table 11.4-1) and
   long-period coefficient **Fv** (Table 11.4-2).
4. Compute adjusted MCE accelerations:

   ```
   SMS = Fa × Ss
   SM1 = Fv × S1
   ```

5. Compute design spectral accelerations:

   ```
   SDS = (2/3) × SMS
   SD1 = (2/3) × SM1
   ```

6. Read SDC from Tables 11.6-1 (SDS-based) and 11.6-2 (SD1-based).
   Governing SDC is the more severe of the two.
   Special rule: **S1 ≥ 0.75 g → SDC E (RC I–III) or SDC F (RC IV)**.

#### Step 2 — Design Story Displacement (§12.8.6)

Amplify the elastic story displacement δxe from the seismic analysis
(ELFP, modal response spectrum, or LRHA) to the design level:

```
δx = (Cd × δxe) / Ie        [Eq. 12.8-15]
```

Where:
- **Cd** = deflection amplification factor (Table 12.2-1)
- **Ie** = seismic importance factor (§11.5.1)

#### Step 3 — Inter-Story Drift

```
Δ = δx(upper) − δx(lower)
Drift ratio = Δ / hsx
```

Where **hsx** = story height below the story under consideration.

#### Step 4 — Check Against Allowable (Table 12.12-1)

| Risk Category | Most Structures | Masonry ≤4 Stories |
|:-------------:|:---------------:|:------------------:|
| I or II       | 0.020 hsx       | 0.025 hsx          |
| III           | 0.015 hsx       | 0.015 hsx          |
| IV            | 0.010 hsx       | 0.010 hsx          |

#### Step 5 — P-Delta Check (§12.8.7)

```
θ = (Px × Δ × Ie) / (Vx × hsx × Cd)        [Eq. 12.8-16]
θmax = 0.5 / (β × Cd)  ≤ 0.25              [Eq. 12.8-17]
```

- θ ≤ 0.10 → P-Delta effects may be neglected
- 0.10 < θ ≤ θmax → Second-order analysis required
- θ > θmax → Structure potentially unstable; redesign required

### Cd Factor Reference (Table 12.2-1 Summary)

| System                          | Cd   |
|:--------------------------------|:----:|
| Special Steel Moment Frame      | 5.5  |
| Special RC Moment Frame         | 5.5  |
| Intermediate Steel Moment Frame | 4.0  |
| Ordinary Steel Moment Frame     | 3.0  |
| Ordinary RC Moment Frame        | 2.5  |
| Special RC Shear Wall           | 5.0  |
| Ordinary RC Shear Wall          | 3.5  |
| Special Wood Shear Wall         | 4.0  |
| Ordinary Wood Shear Wall        | 2.5  |
| Buckling-Restrained Braced Frame| 5.0  |
| Special Concentrically Braced Frame | 5.0 |
| Ordinary Concentrically Braced Frame | 3.25 |
| Simpson Strong-Wall (per ESR)   | 2.5–4.5 |

---

## SHM Sensor Integration Concept

### Sensor Hardware

The SHM system is designed around PCB-based IoT sensor nodes:

| Sensor Type       | Example Component     | Measurement             | Range       |
|:------------------|:----------------------|:------------------------|:------------|
| Accelerometer     | ADXL355 / ICM-42688-P | 3-axis acceleration     | ±2g to ±16g |
| Strain Gauge      | Vishay CEA-XX-125UN   | Microstrain (με)        | ±3,000 με   |
| Displacement      | LVDT / Keyence IL-300 | Inter-story displacement| ±150 mm     |
| Temperature       | BME280                | Thermal compensation    | −40 to +85°C|

Sensor nodes communicate via **MQTT over TLS** to a local IoT gateway
(Raspberry Pi Compute Module or similar), which buffers and forwards
JSON payloads to the HiveAgent endpoint.

### Drift Estimation from Accelerometers

When direct displacement sensors are unavailable, drift is estimated
from accelerometer data using the **double integration method**:

```
a(t) → [mean removal] → ∫ dt → v(t) → [detrend] → ∫ dt → d(t) → [detrend] → Δ_estimated
```

Key considerations:
- Baseline correction (mean removal + linear detrending) is applied at
  each integration stage to suppress low-frequency drift accumulation
- Minimum window: 10 × dominant building period T (seconds)
- For production structural assessment, direct LVDT or GPS-RTK measurements
  supersede accelerometer-integrated estimates

Reference: Boore, D. M. & Bommer, J. J. (2005). Processing of strong-motion
accelerograms: needs, options and consequences. *Soil Dynamics and Earthquake
Engineering*, 25(2), 93–115.

### Alert Thresholds

| Level    | Trigger                | Action                                        |
|:---------|:----------------------:|:----------------------------------------------|
| Nominal  | < 50% of Δa            | Log and continue monitoring                   |
| Yellow ⚠ | ≥ 50% of Δa            | Notify structural engineer; review trend data |
| Red 🔴   | ≥ 80% of Δa            | Escalate immediately; initiate inspection     |
| Critical | ≥ 100% of Δa (CODE VIOLATION) | EVACUATE; contact engineer + authority  |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Building Structure                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │PCB Sensor│    │PCB Sensor│    │PCB Sensor│   (each floor)   │
│  │ADXL355   │    │LVDT      │    │Strain Gge│                  │
│  └─────┬────┘    └─────┬────┘    └─────┬────┘                  │
│        └───────────────┴───────────────┘                       │
│                        │ MQTT/TLS                               │
│                ┌───────▼────────┐                              │
│                │  IoT Gateway   │  (RPi CM4 / ESP32-S3)        │
│                │  JSON buffering│                              │
│                └───────┬────────┘                              │
└────────────────────────│────────────────────────────────────────┘
                         │ HTTPS POST
              ┌──────────▼──────────┐
              │  HiveAgent Platform │
              │  (HiveForge)        │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │ Quake-Drift-Sentinel│  ← This Agent
              │  - SDC classifier   │
              │  - Drift calculator │
              │  - P-Delta checker  │
              │  - SHM ingestor     │
              └──────────┬──────────┘
                         │ Pheromone Emissions
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   Alert Agent    Report Agent    Archive Agent
   (emergency)    (compliance)    (sensor history)
```

---

## Future: PCB-Based Structural Health Monitoring on HiveForge

The long-term vision is a swarm of edge-deployed HiveForge agents running
directly on PCB gateway hardware, enabling:

1. **Edge inference** — Pre-screen acceleration events on-device (ESP32-S3 / RP2350)
   to reduce cloud traffic by 99% during normal operations
2. **Sensor fusion** — Combine accelerometer + strain + displacement readings
   for higher-fidelity drift estimates using Kalman filtering
3. **Earthquake early warning integration** — Subscribe to USGS ShakeAlert feeds
   to begin pre-event baseline calibration before strong motion arrives
4. **Continuous modal identification** — Track natural frequency shifts over time
   as a proxy for structural damage accumulation (stiffness degradation)
5. **BIM integration** — Map sensor IDs to structural element IDs in a
   digital twin (IFC/BIM) for automated post-earthquake damage mapping
6. **Regulatory reporting** — Automatically generate ASCE 7-22 compliant
   drift exceedance reports for submission to AHJs (Authorities Having Jurisdiction)

---

## Project Structure

```
seismic-drift-agent/
├── src/
│   ├── drift-calculator.ts   # ASCE 7-22 drift, SDC, P-Delta calculations
│   ├── shm-concept.ts        # SHM sensor types, ingestion, alert dispatch
│   └── index.ts              # Entry point with worked examples
├── package.json
├── tsconfig.json
├── .env.example
├── mint.sh                   # HiveForge agent mint command
└── README.md
```

## Quick Start

```bash
npm install
npm run build
npm start
```

## Configuration

Copy `.env.example` to `.env` and fill in your HiveForge credentials and
sensor gateway URL before running.

---

*Reference: ASCE/SEI 7-22, Minimum Design Loads and Associated Criteria
for Buildings and Other Structures. American Society of Civil Engineers, 2022.*


---

## Hive Civilization

Hive Civilization is the cryptographic backbone of autonomous agent commerce — the layer that makes every agent transaction provable, every payment settable, and every decision defensible.

This repository is part of the **PROVABLE · SETTABLE · DEFENSIBLE** pillar.

- thehiveryiq.com
- hiveagentiq.com
- agent-card: https://hivetrust.onrender.com/.well-known/agent-card.json
