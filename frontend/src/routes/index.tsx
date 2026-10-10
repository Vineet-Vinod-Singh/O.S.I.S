import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Radar, Navigation, Ship, Target } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "O.S.I.S. — Oil Spill Identification & Source Attribution System",
      },
      {
        name: "description",
        content:
          "Satellite SAR oil spill detection with hydrodynamic Lagrangian drift backtracking and AIS vessel attribution for maritime intelligence.",
      },
    ],
  }),
  component: LandingPage,
});

/* ── Pipeline steps for the four-step section ── */
const PIPELINE = [
  {
    num: "01",
    title: "DETECTION",
    desc: "Sentinel-1 SAR identifies anomalous surface signatures consistent with hydrocarbon slicks through deep-learning segmentation.",
    accent: "var(--accent-blue)",
    icon: Radar,
  },
  {
    num: "02",
    title: "DRIFT BACKTRACKING",
    desc: "Ocean-current and wind modelling via Lagrangian advection estimates where the spill originated hours before detection.",
    accent: "var(--accent-amber)",
    icon: Navigation,
  },
  {
    num: "03",
    title: "AIS CORRELATION",
    desc: "Vessel tracks are evaluated against the computed release corridor to identify ships present during the estimated discharge window.",
    accent: "var(--accent-emerald)",
    icon: Ship,
  },
  {
    num: "04",
    title: "SOURCE ATTRIBUTION",
    desc: "Evidence is combined into an explainable investigation dossier ranking candidate vessels by multi-factor proximity scoring.",
    accent: "var(--accent-rose)",
    icon: Target,
  },
] as const;

function LandingPage() {
  return (
    <div
      style={{
        /* full-bleed — override the root layout padding */
        margin: "0 -20px",
        width: "calc(100% + 40px)",
        position: "relative",
        zIndex: 0,
      }}
    >
      {/* Fixed Background Image for Parallax */}
      <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100vh", zIndex: -1, backgroundColor: "#000" }}>
        <img
          src="/images/landing/hero-sunset-ship.jpg?v=2"
          alt="Ocean background"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", filter: "brightness(0.55)" }}
          fetchPriority="high"
        />
      </div>
      {/* ════════════════════════════════════════════════════════════
          NEW HERO (STORYTELLING DESIGN #5)
         ════════════════════════════════════════════════════════════ */}
      <section
        style={{
          minHeight: "max(100vh, 760px)",
          position: "relative",
          zIndex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >

        {/* Overlays */}
        {/* 0) Top gradient for header readability */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "150px",
            zIndex: -1,
            pointerEvents: "none",
            background: "linear-gradient(to bottom, rgba(3,8,15,0.7) 0%, transparent 100%)",
          }}
        />
        {/* 1) Left-to-right dark gradient for text readability */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: -1,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, rgba(3,8,15,0.8) 0%, transparent 65%)",
          }}
        />
        {/* 2) Bottom gradient into --background behind the cards (REMOVED per user request) */}

        {/* Text Column Container */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            maxWidth: "1240px",
            width: "100%",
            margin: "0 auto",
            padding: "0 48px",
            paddingTop: "96px", // clear the header
            paddingBottom: "64px",
            zIndex: 1,
          }}
          className="landing-text-col"
        >
          <div style={{ maxWidth: "550px", width: "100%" }}>
            {/* Eyebrow Pill */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                border: "1px solid rgba(25,181,230,.35)",
                background: "rgba(255,255,255,.04)",
                borderRadius: "999px",
                padding: "6px 14px",
                marginBottom: "32px",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  color: "white",
                  fontWeight: 600,
                  textShadow: "0 2px 4px rgba(0,0,0,0.6)",
                }}
              >
                Oil Spill Identification & Source Attribution System
              </span>
            </div>

            {/* H1 */}
            <h1
              style={{
                fontSize: "clamp(2.4rem, 5vw, 4rem)",
                fontWeight: 800,
                lineHeight: 1.1,
                margin: 0,
                color: "white",
                letterSpacing: "-0.02em",
              }}
            >
              Intelligence Today
              <br />
              for <span style={{ color: "var(--primary)" }}>Cleaner Oceans</span>
              <br />
              <span style={{ color: "var(--primary)" }}>Tomorrow</span>
            </h1>

            {/* Subline */}
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "white", marginTop: "24px" }}
            >
              Detect. Predict. Attribute. Act.
            </div>

            {/* Body */}
            <p
              style={{
                fontSize: "15px",
                color: "white",
                opacity: 0.75,
                maxWidth: "440px",
                marginTop: "12px",
                lineHeight: 1.6,
                marginBottom: 0,
              }}
            >
              Supporting governments, researchers and maritime operators with advanced oil-spill
              intelligence.
            </p>

            {/* Button Row */}
            <div style={{ display: "flex", gap: "14px", marginTop: "32px", flexWrap: "wrap" }}>
              <Link
                to="/analysis"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "var(--primary)",
                  color: "#020810",
                  height: "44px",
                  padding: "0 24px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  textDecoration: "none",
                  transition: "opacity 0.15s",
                }}
                className="hover:opacity-90"
              >
                Launch Investigation
                <ArrowRight style={{ width: "16px", height: "16px" }} />
              </Link>
              <Link
                to="/overview"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.55)",
                  color: "white",
                  height: "44px",
                  padding: "0 24px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  textDecoration: "none",
                  transition: "background 0.15s",
                }}
                className="hover:bg-white/10"
              >
                Watch Demo
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        {/* Feature Cards (Bottom of hero) */}
        <div
          style={{
            width: "100%",
            paddingBottom: "32px",
            marginTop: "auto",
            zIndex: 1,
          }}
        >
          <div
            className="landing-cards-grid"
            style={{
              maxWidth: "1240px",
              margin: "0 auto",
              padding: "0 48px",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "16px",
            }}
          >
            {/* Card 1: Satellite */}
            <Link
              to="/satellite"
              className="landing-feature-card group"
              aria-label="Satellite Detection"
            >
              <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                <img
                  src="/images/landing/card-satellite.jpg"
                  alt=""
                  loading="lazy"
                  width="300"
                  height="168"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  className="transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                Satellite Detection
              </div>
            </Link>

            {/* Card 2: Drift */}
            <Link
              to="/backtracking"
              className="landing-feature-card group"
              aria-label="Drift Modeling"
            >
              <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                <img
                  src="/images/landing/card-drift.jpg"
                  alt=""
                  loading="lazy"
                  width="300"
                  height="168"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  className="transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                Drift Modeling
              </div>
            </Link>

            {/* Card 3: AIS */}
            <Link to="/ais" className="landing-feature-card group" aria-label="AIS Analysis">
              <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                <img
                  src="/images/landing/card-ais.jpg"
                  alt=""
                  loading="lazy"
                  width="300"
                  height="168"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  className="transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                AIS Analysis
              </div>
            </Link>

            {/* Card 4: Attribution */}
            <Link to="/ais" className="landing-feature-card group" aria-label="Vessel Attribution">
              <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                <img
                  src="/images/landing/card-attribution.png"
                  alt=""
                  loading="lazy"
                  width="300"
                  height="168"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  className="transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                Vessel Attribution
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          HOW IT WORKS — Four-Step Pipeline
         ════════════════════════════════════════════════════════════ */}
      <section
        id="how-it-works"
        style={{
          padding: "100px 32px",
          background: "linear-gradient(165deg, rgba(7,11,16,0.7) 0%, rgba(13,20,28,0.4) 50%, rgba(7,11,16,0.7) 100%)",
          position: "relative",
          overflow: "hidden",
          zIndex: 2,
        }}
      >
        {/* Ambient background glow (Top Right - Cyan) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            transform: "translate(20%, -20%)",
            width: "800px",
            height: "800px",
            background: "radial-gradient(circle, rgba(25,181,230,0.08) 0%, transparent 70%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        {/* Ambient background glow (Bottom Left - Amber) */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            transform: "translate(-20%, 20%)",
            width: "900px",
            height: "900px",
            background: "radial-gradient(circle, rgba(245,158,11,0.04) 0%, transparent 60%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            display: "grid",
            gap: 64,
            alignItems: "center",
            position: "relative",
            zIndex: 1,
          }}
          className="landing-how-grid"
        >
          {/* Text and Pipeline */}
          <div>
            <div style={{ marginBottom: 48 }}>
              <div
                className="font-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  color: "var(--primary)",
                  marginBottom: 16,
                  textTransform: "uppercase",
                  textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                }}
              >
                How It Works
              </div>
              <h2
                style={{
                  fontSize: "clamp(2rem, 3.5vw, 2.8rem)",
                  fontWeight: 800,
                  lineHeight: 1.15,
                  margin: 0,
                  fontFamily: "Inter, system-ui, sans-serif",
                  background: "linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0.6) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: "-0.01em",
                  filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.8))",
                }}
              >
                From Detection to Actionable Insight
              </h2>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: "var(--muted-foreground)",
                  marginTop: 16,
                  maxWidth: 480,
                  fontFamily: "Inter, system-ui, sans-serif",
                  textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                }}
              >
                An end-to-end intelligence pipeline that correlates SAR anomaly detections with
                oceanographic drift models and AIS vessel tracks.
              </p>
            </div>

            {/* Vertical connected pipeline */}
            <div style={{ position: "relative", paddingLeft: 16 }}>
              {/* Vertical connecting line */}
              <div
                style={{
                  position: "absolute",
                  left: 31,
                  top: 24,
                  bottom: 24,
                  width: 2,
                  background:
                    "linear-gradient(to bottom, var(--primary) 0%, var(--accent-emerald) 50%, var(--accent-amber) 100%)",
                  opacity: 0.3,
                  zIndex: 0,
                }}
              />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 32,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {PIPELINE.map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div key={idx} className="group" style={{ display: "flex", gap: 24, alignItems: "flex-start", cursor: "default" }}>
                      <div
                        className="transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(25,181,230,0.2)]"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: `color-mix(in srgb, ${step.accent} 15%, var(--background))`,
                          border: `1px solid color-mix(in srgb, ${step.accent} 40%, transparent)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon style={{ width: 16, height: 16, color: step.accent }} />
                      </div>
                      <div style={{ paddingTop: 4 }} className="transition-all duration-300 group-hover:translate-x-1">
                        <h3
                          className="font-mono transition-colors duration-300"
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "white",
                            letterSpacing: "0.06em",
                            marginBottom: 8,
                            textTransform: "uppercase",
                            textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                          }}
                        >
                          {step.title}
                        </h3>
                        <p
                          style={{
                            fontSize: 14,
                            lineHeight: 1.6,
                            color: "var(--muted-foreground)",
                            margin: 0,
                            fontFamily: "Inter, system-ui, sans-serif",
                            maxWidth: 400,
                            textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                          }}
                        >
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right column: SVG Illustration */}
          <div className="relative group perspective-1000">
            {/* Ambient glow behind card */}
            <div 
              style={{
                position: "absolute",
                inset: -20,
                background: "linear-gradient(45deg, rgba(25,181,230,0.1), rgba(245,158,11,0.05))",
                filter: "blur(30px)",
                opacity: 0,
                transition: "opacity 0.7s",
                zIndex: -1,
              }}
              className="group-hover:opacity-100"
            />
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "1 / 0.9",
                borderRadius: 16,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                background: "linear-gradient(135deg, rgba(10, 16, 25, 0.9) 0%, rgba(5, 8, 12, 0.95) 100%)",
                boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255,255,255,0.08)",
                overflow: "hidden",
                backdropFilter: "blur(20px)",
                transform: "translateZ(0)",
              }}
              className="transition-transform duration-700 group-hover:scale-[1.01]"
            >
              {/* Ocean grid background */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(to right, rgba(29,42,54,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(29,42,54,0.12) 1px, transparent 1px)",
                backgroundSize: "32px 32px",
              }}
            />

            {/* SVG intelligence scene */}
            <svg
              viewBox="0 0 500 450"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
              }}
              aria-hidden="true"
            >
              <defs>
                {/* Spill fill gradient */}
                <radialGradient id="spillGrad" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0%" stopColor="var(--destructive)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--destructive)" stopOpacity="0.06" />
                </radialGradient>
                {/* Origin uncertainty */}
                <radialGradient id="originGrad" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0%" stopColor="var(--accent-amber)" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="var(--accent-amber)" stopOpacity="0" />
                </radialGradient>
                {/* Pulse animation for spill */}
                <filter id="spillGlow">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
                </filter>
              </defs>

              {/* ── Coastline contour (top-right, subtle) ── */}
              <path
                d="M 500 0 L 500 85 Q 465 90, 440 105 Q 410 125, 395 115 Q 375 100, 360 110 Q 340 125, 330 118 Q 310 105, 295 115 Q 275 130, 260 125 L 260 0 Z"
                fill="#111A24"
                stroke="#1D2A36"
                strokeWidth="1"
                opacity="0.6"
              />
              {/* Coastline edge highlight */}
              <path
                d="M 500 85 Q 465 90, 440 105 Q 410 125, 395 115 Q 375 100, 360 110 Q 340 125, 330 118 Q 310 105, 295 115 Q 275 130, 260 125"
                fill="none"
                stroke="#1D2A36"
                strokeWidth="1.5"
                opacity="0.8"
              />

              {/* ── Lat/Lon reference lines ── */}
              <line
                x1="0"
                y1="200"
                x2="500"
                y2="200"
                stroke="#1D2A36"
                strokeWidth="0.5"
                strokeDasharray="4 8"
                opacity="0.4"
              />
              <line
                x1="250"
                y1="0"
                x2="250"
                y2="450"
                stroke="#1D2A36"
                strokeWidth="0.5"
                strokeDasharray="4 8"
                opacity="0.4"
              />

              {/* LAYER 1: VESSEL TRAJECTORIES */}
              <polyline
                points="125,148 140,155 158,160 175,162 188,158"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="0.8"
                strokeDasharray="3 4"
                opacity="0.25"
              />
              <polyline
                points="80,235 110,228 145,220 180,215 210,218 240,225"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="0.8"
                strokeDasharray="3 4"
                opacity="0.25"
              />
              <polyline
                points="220,160 230,175 235,195 232,210"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="0.8"
                strokeDasharray="3 4"
                opacity="0.2"
              />

              {/* LAYER 2: DRIFT TRAJECTORY */}
              <path
                d="M 195,210 Q 220,240 240,265 Q 265,295 280,320 Q 290,340 305,355"
                fill="none"
                stroke="var(--accent-amber)"
                strokeWidth="1.8"
                strokeDasharray="6 5"
                opacity="0.7"
                className="landing-drift-path"
              />
              <polygon points="260,282 265,275 270,283" fill="var(--accent-amber)" opacity="0.45" />
              <polygon points="290,335 294,327 299,336" fill="var(--accent-amber)" opacity="0.35" />

              {/* LAYER 3: ESTIMATED ORIGIN */}
              <circle cx="195" cy="210" r="28" fill="url(#originGrad)" />
              <circle
                cx="195"
                cy="210"
                r="28"
                fill="none"
                stroke="var(--accent-amber)"
                strokeWidth="0.8"
                strokeDasharray="3 3"
                opacity="0.4"
              />
              <circle cx="195" cy="210" r="4" fill="var(--accent-amber)" />
              <circle
                cx="195"
                cy="210"
                r="7"
                fill="none"
                stroke="var(--accent-amber)"
                strokeWidth="1"
                opacity="0.5"
              />

              {/* LAYER 4: OIL SPILL DETECTION REGION */}
              <path
                d="M 290,340 Q 300,330 320,335 Q 340,340 350,355 Q 358,370 352,385 Q 342,400 325,405 Q 305,408 290,400 Q 275,390 272,375 Q 270,360 278,348 Z"
                fill="url(#spillGrad)"
                stroke="var(--destructive)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              <path
                d="M 305,355 Q 315,348 325,355 Q 335,365 330,378 Q 322,388 310,385 Q 298,380 300,368 Z"
                fill="var(--destructive)"
                fillOpacity="0.18"
                stroke="none"
              />
              <circle
                cx="315"
                cy="370"
                r="18"
                fill="none"
                stroke="var(--destructive)"
                strokeWidth="0.8"
                opacity="0.35"
                className="landing-spill-pulse"
              />

              {/* LAYER 5: VESSEL MARKERS */}
              <g>
                <polygon points="188,158 184,165 192,165" fill="var(--primary)" opacity="0.85" />
                <circle
                  cx="188"
                  cy="161"
                  r="8"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="0.7"
                  opacity="0.3"
                />
              </g>
              <g>
                <polygon points="240,225 236,232 244,232" fill="var(--primary)" opacity="0.6" />
                <circle
                  cx="240"
                  cy="228"
                  r="7"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="0.6"
                  opacity="0.2"
                />
              </g>
              <g>
                <polygon points="232,210 228,217 236,217" fill="var(--primary)" opacity="0.4" />
              </g>

              {/* LABELS */}
              <g>
                <rect
                  x="340"
                  y="343"
                  width="86"
                  height="18"
                  rx="3"
                  fill="#0A1018"
                  fillOpacity="0.85"
                  stroke="var(--destructive)"
                  strokeWidth="0.6"
                  opacity="0.8"
                />
                <text
                  x="383"
                  y="355"
                  textAnchor="middle"
                  fill="var(--destructive)"
                  fontSize="8"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  letterSpacing="0.1em"
                  opacity="0.9"
                >
                  SAR DETECTION
                </text>
              </g>
              <g>
                <rect
                  x="130"
                  y="188"
                  width="54"
                  height="16"
                  rx="3"
                  fill="#0A1018"
                  fillOpacity="0.85"
                  stroke="var(--accent-amber)"
                  strokeWidth="0.5"
                  opacity="0.7"
                />
                <text
                  x="157"
                  y="199"
                  textAnchor="middle"
                  fill="var(--accent-amber)"
                  fontSize="7"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  letterSpacing="0.1em"
                  opacity="0.85"
                >
                  EST. ORIGIN
                </text>
              </g>
              <g>
                <text
                  x="228"
                  y="290"
                  fill="var(--accent-amber)"
                  fontSize="7"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  letterSpacing="0.08em"
                  opacity="0.5"
                  transform="rotate(-52, 228, 290)"
                >
                  DRIFT BACKTRACK
                </text>
              </g>
              <g>
                <rect
                  x="100"
                  y="135"
                  width="80"
                  height="16"
                  rx="3"
                  fill="#0A1018"
                  fillOpacity="0.8"
                  stroke="var(--primary)"
                  strokeWidth="0.5"
                  opacity="0.6"
                />
                <text
                  x="140"
                  y="146"
                  textAnchor="middle"
                  fill="var(--primary)"
                  fontSize="7"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  letterSpacing="0.1em"
                  opacity="0.7"
                >
                  AIS CORRELATION
                </text>
              </g>

              <text
                x="197"
                y="155"
                fill="var(--primary)"
                fontSize="6.5"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                opacity="0.5"
              >
                V-01
              </text>
              <text
                x="248"
                y="224"
                fill="var(--primary)"
                fontSize="6.5"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                opacity="0.4"
              >
                V-02
              </text>
              <text
                x="240"
                y="209"
                fill="var(--primary)"
                fontSize="6.5"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                opacity="0.3"
              >
                V-03
              </text>
            </svg>

            {/* Corner overlays */}
            <span
              className="font-mono"
              style={{
                position: "absolute",
                top: 14,
                left: 14,
                fontSize: 9,
                color: "var(--muted-foreground)",
                letterSpacing: "0.12em",
                opacity: 0.55,
                textTransform: "uppercase",
              }}
            >
              Sentinel-1 SAR
            </span>
            <span
              className="font-mono"
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                fontSize: 9,
                letterSpacing: "0.1em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                textTransform: "uppercase",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--muted-foreground)",
                  display: "inline-block",
                }}
              />
              <span style={{ color: "var(--muted-foreground)", opacity: 0.8 }}>
                Illustrative Data
              </span>
            </span>
            <span
              className="font-mono"
              style={{
                position: "absolute",
                bottom: 12,
                left: 14,
                fontSize: 9,
                color: "var(--muted-foreground)",
                letterSpacing: "0.06em",
                opacity: 0.5,
              }}
            >
              15.25°N &nbsp;72.45°E
            </span>
            <span
              className="font-mono"
              style={{
                position: "absolute",
                bottom: 12,
                right: 14,
                fontSize: 9,
                color: "var(--muted-foreground)",
                letterSpacing: "0.08em",
                opacity: 0.45,
                textTransform: "uppercase",
              }}
            >
              Arabian Sea Sector
            </span>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FINAL CTA
         ════════════════════════════════════════════════════════════ */}
      <section
        style={{
          padding: "72px 32px",
          textAlign: "center",
          background: "rgba(7,11,16,0.6)",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2
            className="font-mono"
            style={{
              fontSize: "clamp(1.2rem, 2.5vw, 1.6rem)",
              fontWeight: 700,
              color: "var(--foreground)",
              lineHeight: 1.25,
              letterSpacing: "0.02em",
              margin: 0,
            }}
          >
            Ready to investigate?
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: "var(--muted-foreground)",
              marginTop: 14,
            }}
          >
            Access the full operational dashboard with live incident data, SAR detection, drift
            analysis, and vessel attribution.
          </p>
          <Link
            to="/overview"
            className="font-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              padding: "14px 32px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textDecoration: "none",
              marginTop: 32,
              border: "none",
              transition: "opacity 0.15s",
            }}
            id="cta-dashboard"
          >
            OPEN OPERATIONAL DASHBOARD
            <ArrowRight style={{ width: 15, height: 15 }} />
          </Link>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          LANDING FOOTER
         ════════════════════════════════════════════════════════════ */}
      <footer
        className="font-mono"
        style={{
          padding: "32px",
          textAlign: "center",
          fontSize: 11,
          color: "var(--muted-foreground)",
          letterSpacing: "0.04em",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          background: "rgba(9,14,21,0.8)",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div>
          <span style={{ opacity: 0.7 }}>O.S.I.S.</span>
          <span style={{ opacity: 0.3, margin: "0 8px" }}>·</span>
          <span style={{ opacity: 0.6 }}>
            Oil Spill Identification &amp; Source Attribution System
          </span>
        </div>
        <div style={{ opacity: 0.5, fontSize: 10 }}>
          Analytical evidence only, not legal attribution
        </div>
      </footer>

      {/* ── Responsive overrides (injected as a style tag for self-containment) ── */}
      <style>{`
        .landing-how-grid {
          grid-template-columns: 1fr 1fr;
        }

        /* Tablet */
        @media (max-width: 960px) {
          .landing-how-grid {
            grid-template-columns: 1fr;
          }
          .landing-bg-img {
            object-position: 52% 20% !important;
          }
        }

        /* Mobile */
        @media (max-width: 600px) {
          .landing-bg-img {
            object-position: 52% 16% !important;
          }
        }

        /* Hover states */
        #cta-explore:hover {
          opacity: 0.9;
        }
        #cta-how:hover {
          border-color: var(--primary) !important;
          color: var(--primary) !important;
        }
        .landing-pipeline-card:hover {
          border-color: rgba(25, 181, 230, 0.25) !important;
        }
        #cta-dashboard:hover {
          opacity: 0.9;
        }

        /* Subtle spill pulse animation */
        .landing-spill-pulse {
          animation: landing-spill-pulse-k 3s ease-in-out infinite;
        }
        @keyframes landing-spill-pulse-k {
          0%, 100% { opacity: 0.35; r: 18; }
          50% { opacity: 0.12; r: 24; }
        }

        /* Subtle drift path animation */
        .landing-drift-path {
          animation: landing-drift-k 4s linear infinite;
        }
        @keyframes landing-drift-k {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -22; }
        }

        /* Ocean current lines — majestic, ultra-subtle oceanic drift */
        .landing-currents-svg {
          animation: landing-currents-flow 120s linear infinite;
          will-change: transform;
        }
        @keyframes landing-currents-flow {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-50%, 0, 0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-currents-svg {
            animation: none !important;
          }
        }

        .landing-feature-card {
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(8,16,28,0.72);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          overflow: hidden;
          transition: border-color 0.2s, transform 0.2s;
          display: block;
          text-decoration: none;
        }
        .landing-feature-card:hover {
          border-color: rgba(25,181,230,0.4);
          transform: translateY(-2px);
        }
        .landing-feature-card:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }
        
        @media (max-width: 1023px) {
          .landing-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 600px) {
          .landing-text-col {
            padding: 0 24px !important;
            padding-top: 56px !important;
            padding-bottom: 64px !important; /* change layout for mobile */
          }
          .landing-cards-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            padding: 0 24px !important;
            position: relative;
          }
        }
      `}</style>
    </div>
  );
}
