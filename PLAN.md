# Aero'ed — The Operating System for Drone Relay Corridors

> **Tagline:** *Bridging the healthcare gap, one relay at a time.*

---

## 1. The Problem

### Rural Canada Has a Healthcare Crisis

- **18% of Canadians** live in rural/remote areas, but only **8% of physicians** practice there. ^[NIH / healthinsight.ca]
- In Ontario, **99.4%** of urban residents live within 5 km of a pharmacy — only **40.9%** of rural residents do. ^[NIH — Ontario pharmacy access study]
- **72% of Northern Ontario communities** have no local pharmacist access. ^[NIH]
- Rural Canadians face **higher death rates, increased infant mortality, and shorter life expectancy**. ^[publications.gc.ca]
- Indigenous communities face compounded barriers from geographic isolation and systemic gaps. ^[euclid.int]

### The Northern Quebec Cree Context

- **9 Cree communities** along James Bay in Northern Quebec (Eeyou Istchee) — all served by nursing stations, not hospitals
- Patients must travel **hundreds of kilometers** by air for medication or specialized care
- Many communities are **only accessible by plane** for months at a time
- **Staffing shortages** mean healthcare facilities can't fully utilize available supplies
- **Language and cultural barriers** deter Indigenous individuals from seeking care
- **COVID-19 exposed** critical supply chain vulnerabilities — PPE shortages, transport disruptions

### The Delivery Problem

- Ground transport to remote communities can take **hours or days**, especially in winter
- Existing air delivery (charter flights, helicopters) costs **$5,000–$15,000+ per flight** — unsustainable for routine medication
- Patients miss critical medication windows, leading to **preventable deterioration and hospitalizations**
- Some communities lack ambulance services entirely — nursing stations are the only lifeline

---

## 2. Our Solution: Aero'ed

**Aero'ed** is a **software platform for operating drone relay corridors** — enabling year-round medicine delivery to remote Canadian communities through a chain of charging stations.

We are **not** a drone manufacturer or a station builder. We are the **dispatch, routing, tracking, and chain-of-custody intelligence layer** that makes relay delivery networks work.

### The Relay Concept

```
Hospital/Pharmacy ──► Station A ──► Station B ──► Station C ──► Rural Community
                   Drone 1      Drone 2      Drone 3      Drone 4
                   (cartridge    (cartridge    (cartridge    (delivery)
                    swap)         swap)         swap)
```

1. **Order placed** — A healthcare provider requests a delivery through Aero'ed (web dashboard, voice command, or clinic portal)
2. **AI Dispatch** — Gemini API calculates the optimal relay route considering weather, station readiness, and priority
3. **Auto-launch** — System automatically assigns the best available drone and launches upon approval — no manual intervention
4. **Sealed Cartridge Swap** — At each station, a **standardized sealed cartridge** slots from one drone into the next. No manual handling
5. **Blockchain Receipt** — Every handoff is recorded as an **immutable transaction on Solana** — tamper-proof chain-of-custody
6. **Real-time tracking** — Live positions, ETAs, and progress updated in real-time across all portals
7. **Delivery confirmed** — Voice notification via ElevenLabs to the receiving health worker. Record closed

### Why Relay Beats Direct Flight

| Challenge | Direct Flight | Relay Corridor (Aero'ed) |
|---|---|---|
| Range | Limited to 20–60 km per drone | Extends practical corridor length to **hundreds of km** |
| Battery dependency | Single point of failure | Each leg uses a fresh, optimally-charged drone |
| Winter resilience | Battery performance drops 20–40% in cold | Stations maintain batteries in heated enclosures |
| Scalability | Requires expensive long-range drones | Uses affordable, proven short-range drones |
| Reliability | One drone failure = mission failure | 2–3 backup drones per station node |

---

## 3. Drone Specifications & Research

### Reference Platforms

| Drone | Range | Payload | Relevance |
|---|---|---|---|
| **DDC Canary** (fmr. Sparrow) | 20–30 km | 4.5 kg | Canadian-made, **healthcare-proven**, BVLOS approved by Transport Canada ^[dronedeliverycanada.com] |
| **DDC Robin XL** | 60 km | 11.3 kg | Temperature-controlled, harsh climate rated ^[DDC / suasnews.com] |
| **DDC Condor** | Heavy-lift | 180 kg | Under testing with Transport Canada for heavy cargo ^[stattimes.com] |
| **DJI FlyCart 30** | 16–26 km | 30 kg | Heavy-lift reference |
| **Zipline P2** | 160 km (fixed-wing) | 1.8 kg | Proven medical delivery in Rwanda/Ghana |

### Key BVLOS Milestone (2025)

- **Transport Canada expanded BVLOS rules in November 2025** — new "Level 1 Complex Operations" certification simplifies approval for lower-risk flights ^[canada.ca]
- DDC's Canary drone already holds BVLOS + dangerous goods transport approval for the "Care by Air" and "DroneCare" medical routes
- Drones under 150 kg can now operate in uncontrolled airspace for BVLOS without case-by-case SFOCs

### Prototype Assumptions

- **Drone class:** Multirotor VTOL (Canary-class)
- **Effective range per leg:** **20 km** (conservative — accounts for wind, cold, payload)
- **Payload:** 4–5 kg (covers most medication, insulin, blood samples, vaccines)
- **Flight speed:** ~80 km/h → **~15 min per leg** (flight + cartridge swap)
- **Station spacing:** 15–20 km

---

## 4. Station Infrastructure (Assumptions for MVP)

> **For the hackathon prototype, we assume station infrastructure exists and focus entirely on the software platform.** The pitch acknowledges that a real deployment would partner with infrastructure providers (e.g., telecom tower operators, Indigenous Services Canada facilities, or existing remote power installations).

### Station Components (Conceptual)

| Component | Purpose |
|---|---|
| **2–3 drones + charging pads** | Ready for relay; redundancy |
| **Sealed cartridge dock** | Standardized cargo swap — no manual handling |
| **Power** | Grid/hybrid in pilot phase; solar+battery for remote expansion |
| **Comms** | LoRa radio + satellite (Starlink) for telemetry |
| **Weather sensors** | Wind, temperature, visibility — feeds into routing AI |
| **Heated battery compartments** | Maintains drone batteries at optimal temp in winter |

---

## 5. The Software Platform (What We Built)

### 5.1 Three-Portal Architecture

The platform serves three distinct user roles through a unified data layer:

#### Admin Portal (`/admin`) — Platform Operations
| Tab | Features |
|---|---|
| **Overview** | Real-time ops metrics, live weather radar map (Canada GeoMet WMS), AI recommendation engine, delivery list with status filtering, weather station heatmap |
| **Routing** | Per-delivery weather analysis, manual reroute capability, Gemini-powered path insight AI, route visualization |
| **Fleet** | Full drone fleet management, interactive corridor map with SVG drone icons, drone relocation, battery/health monitoring |
| **Analytics** | AI-powered Q&A about system state via Gemini, natural language fleet queries |

#### Distributor Portal (`/distributor`) — Pharmacy Dispatch
| Tab | Features |
|---|---|
| **Overview** | Stats (pending/active/completed/fleet), live corridor map with drone selection, drone detail sidebar with telemetry, fleet status table |
| **Incoming Requests** | Clinic supply requests awaiting approval, Gemini severity scoring, approve (auto-launches) / reject with confirmation modals |
| **Active Deliveries** | Real-time progress bars, route visualization with station dots, ETA countdown, cancel button |
| **Dispatch Console** | AI Assist mode (natural language → Gemini plans and auto-launches) + Manual mode (origin/destination/priority picker) |
| **Custody Ledger** | Blockchain-verified delivery receipts with Solana TX hashes |
| **History** | Complete delivery timeline with filtering |

#### Receiver Portal (`/receiver`) — Clinic/Health Worker
| Tab | Features |
|---|---|
| **Dashboard** | Stats, live corridor map (only inbound drones), next delivery card with ETA countdown, ElevenLabs voice arrival alerts |
| **Request Supplies** | Form with voice dictation (Web Speech API), payload/priority/notes, Gemini auto-classifies severity, creates REQUESTED delivery |
| **My Requests** | Real-time tracking of all related deliveries, progress bars, cancel for pre-approved requests |
| **Inventory** | Received delivery history with payloads and dates |

### 5.2 Delivery Lifecycle (Fully Automated)

```
REQUESTED ─── Distributor approves ──► auto-launch:
                                        1. findBestRoute() computes optimal path using weather data
                                        2. Assigns first available drone (highest battery)
                                        3. ETA = haversine route distance / 80 km/h + weather delays
                                        4. Status → IN_TRANSIT, simulation timer starts (15s legs)
                                        5. Drone advances through stations automatically
                                        6. On completion → DELIVERED, drone freed, voice alert sent

REQUESTED ─── Distributor rejects ──► REJECTED

IN_TRANSIT ─── Weather detected ──► WEATHER_HOLD (auto-resumes when clear)
IN_TRANSIT ─── Admin reroutes ──► REROUTED (new path, continues)
IN_TRANSIT ─── Dispatcher cancels ──► REJECTED (drone freed)

PENDING_DISPATCH ── No route available ──► lifecycle monitor retries every 15s
READY_TO_LAUNCH ── No drone available ──► lifecycle monitor retries every 15s
```

**Key: No manual "Launch" button exists.** Every delivery auto-launches the moment it's approved or created by a dispatcher.

### 5.3 AI-Powered Dispatch (Gemini API)
- **Natural language delivery requests** — "Send insulin to Chisasibi, urgent priority"
- Gemini parses intent, identifies medicine type, calculates priority, proposes optimal relay route
- **Request review** — Gemini auto-generates severity scores (1–5) and one-sentence summaries for clinic requests
- **Dynamic rerouting** — if a station goes offline or weather degrades, Gemini recalculates mid-flight
- **Weather impact analysis** — integrates real-time weather data to preemptively adjust dispatch timing
- **Analytics Q&A** — natural language queries about fleet state, delivery history, performance

### 5.4 Voice Interface (ElevenLabs)
- **Voice dispatch** — healthcare workers can dictate delivery requests using Web Speech API → Gemini classifies
- **Arrival alerts** — automated TTS voice calls when delivery ETA < 15 minutes
- **Alert narration** — critical system alerts voiced for hands-free awareness
- **Accessibility** — serves communities where typed interfaces are impractical

### 5.5 Blockchain Chain-of-Custody (Solana)
- Every **cartridge handoff** is recorded as an on-chain transaction on Solana
- Creates an **immutable, tamper-proof audit trail** — critical for controlled substances
- **Custody ledger** visible in Distributor Portal with verification badges
- Public verification: anyone (regulator, pharmacy, patient) can verify on-chain

### 5.6 Real-Time Data Layer (MongoDB Atlas)
- **Operational database** — live drone states, station telemetry, active delivery records
- **Auto-seeding** — demo data populates on startup with realistic Northern Quebec corridor
- **Delivery simulation** — server-side interval timers advance delivery legs every 15 seconds
- **Lifecycle monitor** — background process retries failed launches (no route / no drone) every 15 seconds

### 5.7 Real Weather Integration
- **Canada Government GeoMet radar** — WMS tile overlay (`RADAR_1KM_RRAI`) on admin weather map
- **Open-Meteo API** — per-station weather snapshots (temperature, wind, visibility, precipitation)
- **Classification engine** — conditions classified as CLEAR / WATCH / UNSTABLE / SEVERE
- **Routing integration** — weather state drives route selection, holds, and rerouting decisions

### 5.8 ETA Calculation (Accurate, Not Random)

```
routeDistanceKm = sum of haversine distances between consecutive route stations
travelMinutes = (routeDistanceKm / 80 km/h) × 60
weatherDelay = estimateRouteMinutes(route, priority, warnings) adjustments
ETA = Date.now() + travelMinutes + weatherDelay
```

### 5.9 Map Components
- **Shared CorridorMap** — Leaflet.js, preserves pan/zoom on prop changes, SVG quadcopter drone icons, station markers, delivery route overlays
- **Admin OverviewWeatherMap** — GeoMet radar layer, weather station halos, same SVG drone icons
- **Admin Fleet CorridorMap** — corridor lines, drone focus, relay visualization

---

## 6. Demo Corridor: Chibougamau → Whapmagoostui

Our demo simulates the **James Bay inland corridor** through Eeyou Istchee (Cree territory):

```
Chibougamau Hub (Distribution)
     │
     ├── Mistissini
     ├── Nemaska
     ├── Waskaganish
     ├── Eastmain
     ├── Wemindji
     ├── Chisasibi
     └── Whapmagoostui

Side branch: Chibougamau Hub → LaGrande Relay → Radisson → Whapmagoostui (Northlink spine)
```

- **~600 km** total network coverage
- **12 stations** (1 distribution hub, 11 relay/community stations)
- **5 drones** in seed fleet (Relay Alpha through Echo)
- **Real community names** from the Cree Nation of Eeyou Istchee

---

## 7. Sponsor Tool Integration Summary

| Tool | Role in Platform | Demo Visibility |
|---|---|---|
| **Gemini API** | AI dispatch, route optimization, NLP delivery requests, severity scoring, weather rerouting, analytics Q&A | User types/speaks a delivery request → Gemini parses, plans route, explains ETA. Clinic requests get auto-scored |
| **MongoDB Atlas** | Real-time operational database — drone states, deliveries, stations, simulation state | Live dashboard updates as drones move; delivery lifecycle runs server-side |
| **Snowflake** | Analytics warehouse — corridor economics, delivery history, government compliance reports | Analytics tab with corridor performance metrics |
| **Solana** | Immutable chain-of-custody ledger | Each delivery shows Solana TX hash in Custody Ledger; verification badge |
| **ElevenLabs** | Voice alerts, delivery status TTS, arrival notifications | Receiver gets voice ETA alert when delivery approaches; voice input for requests |

---

## 8. Business Model

### Beachhead Customer: Cree Board of Health and Social Services of James Bay (CBHSSJB)

Our initial target is the **James Bay Cree communities** — specifically the nursing station network in Eeyou Istchee, Northern Quebec. This region has:
- **9 remote Cree communities** along the James Bay corridor
- Existing reliance on expensive charter flights and seasonal road access
- Active **Cree Health Board** managing healthcare delivery with federal/provincial funding
- Strong community governance structure through the **Grand Council of the Crees**

### Revenue Streams

| Stream | Description | Pricing |
|---|---|---|
| **Per-Delivery Fee** | Charge per relay delivery completed | $75–$200/delivery (distance + priority based) |
| **Corridor Operating Contract** | Health authority contracts Aero'ed to manage a relay corridor | $500K–$2M/year per corridor |
| **Platform Licensing (Future)** | License the software to other drone operators running their own corridors | $5K–$15K/month |

### Unit Economics

**Single 100 km pilot corridor (5 stations, 15 drones):**

| Item | Cost |
|---|---|
| Station infrastructure (5 × $30K) | $150,000 |
| Drones (15 × $20K) | $300,000 |
| Software + integration | $75,000 |
| **Total Year 1 capex** | **$525,000** |
| Annual operations (maintenance, comms, power) | ~$75,000/year |

**Revenue at base utilization (3 deliveries/day):**
- 3 × 365 × $150 avg = **$164K/year**
- Net after ops: ~$89K/year
- **Simple payback: ~5.5 years** at base utilization alone

**However — the real economics depend on corridor contracts:**
- A single government corridor contract ($500K–$2M/year) covers costs in **Year 1**
- Charter flight replacement savings for the health authority: **$1.5M–$5M/year** per corridor
- The value proposition is not per-delivery margin; it's **displacing $15K helicopter trips with $150 drone relays**

---

## 9. Market Opportunity

- **~1,200 remote/isolated communities** in Canada with limited healthcare access
- **Canada delivery drone market: $41.4M (2023) → $596.4M by 2030** (46.4% CAGR) ^[grandviewresearch.com]
- **Canada total drone market: $617M (2025) → $1.5B by 2034** ^[imarcgroup.com]
- **Global medical drone delivery: $420M (2025)** — growing at 25%+ CAGR ^[polarismarketresearch.com]
- Federal/provincial healthcare budgets allocate billions to rural health — drones replace helicopters at a fraction of the cost
- **Transport Canada's November 2025 BVLOS expansion** removes the single biggest regulatory barrier

---

## 10. Competitive Landscape

| Competitor | Approach | Why Aero'ed Is Different |
|---|---|---|
| **Drone Delivery Canada** | Direct point-to-point delivery (20–60 km) | We orchestrate **multi-station relay corridors** — DDC could be our hardware partner |
| **Zipline** | Fixed-wing long-range (catapult launch) | Not relay-based; no Canadian presence; not suitable for harsh winter VTOL |
| **Amazon Prime Air / Wing** | Urban/suburban last-mile | Not designed for remote/rural; no cold-weather or relay capability |

**Our moat:** Relay corridor orchestration software — dispatch, routing, handoff tracking, chain-of-custody, analytics. The drones and stations are **commodities**; the intelligence layer is the product.

---

## 11. Roadmap

### Phase 1 — Hackathon MVP (Now ✅)
- [x] Full software platform with 3-portal architecture
- [x] Automated delivery lifecycle (request → approve → launch → track → deliver)
- [x] Real weather integration (Government of Canada GeoMet radar + Open-Meteo API)
- [x] AI dispatch with Gemini (natural language + structured output)
- [x] Voice interface (ElevenLabs TTS + Web Speech API dictation)
- [x] Solana chain-of-custody ledger
- [x] Simulated James Bay corridor with real Cree community station names

### Phase 2 — Pilot (Year 1)
- Deploy first physical corridor with CBHSSJB / Ontario Health North
- Partner with DDC for Canary hardware; focus on software operations
- SFOC → Level 1 Complex Operations certification under new 2025 BVLOS rules
- Community engagement with Cree Nation leadership

### Phase 3 — Expansion (Years 2–3)
- 5–10 corridors across Northern Quebec, Ontario, Manitoba, BC
- Indigenous community partnerships and training programs
- Grid-to-solar station transition for remote nodes
- Non-medical cargo to increase corridor utilization (mail, lab samples, emergency supplies)

### Phase 4 — Platform Scale (Years 3–5)
- License platform to international markets (Northern Scandinavia, Alaska, remote Pacific Islands)
- API ecosystem for third-party corridor operators
- Full Snowflake analytics integration for government compliance reporting

---

## 12. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React + Vite, Leaflet.js (OpenStreetMap), Zustand state management |
| **Backend** | Node.js + Express |
| **Real-time DB** | MongoDB Atlas (drone states, deliveries, stations) |
| **Analytics DW** | Snowflake (corridor economics, historical analytics, government reports) |
| **AI/NLP** | Gemini API (dispatch optimization, NLP requests, weather rerouting, severity scoring) |
| **Blockchain** | Solana (chain-of-custody ledger, delivery payment contracts) |
| **Voice** | ElevenLabs (TTS arrival alerts, status narration) + Web Speech API (dictation) |
| **Weather** | Open-Meteo API + Government of Canada GeoMet WMS radar tiles |
| **Maps** | Leaflet.js + OpenStreetMap (free, open-source) |
| **Simulation** | Server-side interval timers (15s legs), lifecycle monitor for auto-retries |

---

## 13. Hackathon Deliverables

| Deliverable | Status |
|---|---|
| ✅ Core business plan & model | This document |
| ✅ Software prototype (3-portal dispatch + tracking + relay simulation) | Built & running |
| ✅ Automated delivery lifecycle (no manual launch) | Implemented |
| ✅ Real weather integration | Government radar + Open-Meteo |
| ✅ AI dispatch (Gemini) | Natural language + structured output |
| ✅ Voice interface (ElevenLabs + Web Speech API) | Arrival alerts + dictation |
| ✅ Chain-of-custody ledger (Solana) | TX hashes with verification |
| 🔲 Pitch deck (8–10 slides) | To create |
| 🔲 Source code (submitted to Devpost) | To submit |
| 🔲 Demo video | Stretch goal |

---

## 14. Pitch Talking Points

### Slide 1: The Human Cost
*"A diabetic elder in Chisasibi waits days for insulin when weather grounds charter flights. A $15,000 helicopter trip for a $30 medication. 72% of Northern communities have no pharmacist. This isn't a developing-world problem — this is happening in Canada right now."*

### Slide 2: The Relay Insight
*"We don't need a better drone. We need a smarter network. Sealed cartridge swap. Fresh drone. 15 minutes later, it's at the next station. Range doesn't matter when the network extends for hundreds of kilometers."*

### Slide 3: The Platform
*"Aero'ed is the operating system for drone relay corridors. Three portals — admin, pharmacy, clinic — all sharing one live data layer. A clinic requests insulin; the pharmacy approves; Gemini computes the route; a drone launches automatically. No phone calls. No fax machines. No $15K helicopter."*

### Slide 4: Live Demo
Dispatch a delivery → watch it relay through stations → see Solana transactions log → hear ElevenLabs voice alert.

### Slide 5: The Technology
- Gemini AI for intelligent dispatch and severity scoring
- Real-time weather from Government of Canada radar
- ElevenLabs voice interface for remote healthcare workers
- Solana blockchain for auditable chain-of-custody
- MongoDB Atlas for live fleet state

### Slide 6: The Market
*"$596M Canadian delivery drone market by 2030. ~1,200 remote communities. Transport Canada just cleared BVLOS in November 2025. The regulatory gate is open."*

### Slide 7: Business Model
*"One corridor contract with a health authority: $500K–$2M/year. Charter flight savings: $1.5M–$5M/year. We replace a $15,000 helicopter flight with a $150 drone relay."*

### Slide 8: The Team & Ask
*McGill AeroHacks 2026 submission. Seeking pilot partnership with CBHSSJB or Ontario Health North.*

---

## 15. Research Sources

### Healthcare Access
- 18% of Canadians are rural, 8% of doctors serve them ^[NIH / healthinsight.ca]
- 72% of Northern Ontario communities lack pharmacist access ^[NIH]
- 40.9% of Ontario rural residents within 5 km of pharmacy vs. 99.4% urban ^[NIH]
- Cree communities accessible only by plane for months; must travel hundreds of km for medication ^[rimuhc.ca, fsss.qc.ca]
- Viens Commission documented systemic barriers to Indigenous healthcare ^[cbc.ca]

### Drone Industry
- DDC Canary: BVLOS + dangerous goods approved for healthcare routes ^[dronedeliverycanada.com, newswire.ca]
- DDC Condor: Under testing with Transport Canada for heavy cargo ^[stattimes.com]
- Transport Canada BVLOS expansion: November 4, 2025 — Level 1 Complex Operations certification ^[canada.ca, cbc.ca]
- Canada delivery drone market: $41.4M (2023) → $596.4M by 2030, 46.4% CAGR ^[grandviewresearch.com]
- Canada total drone market: $617M (2025) → $1.5B by 2034 ^[imarcgroup.com]
- Global medical drone delivery: $420M (2025), 25%+ CAGR ^[polarismarketresearch.com]

### Regulatory
- BVLOS regulatory framework progress — Transport Canada ^[canada.ca]
- Level 1 Complex Operations pilot certification available April 2025 ^[abjacademy.global]
- Drones under 150 kg can operate BVLOS in uncontrolled airspace without individual SFOCs ^[canada.ca]
