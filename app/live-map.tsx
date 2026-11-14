"use client";

import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Radar } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LiveFlight } from "./live-flights";

/** Mirrors worker/planes.ts. */
type Plane = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  lat: number;
  lon: number;
  altitude: number | null;
  ground: boolean;
  speed: number | null;
  track: number | null;
  climb: number | null;
};

const ABE = { lat: 40.652363, lon: -75.440406 };
const POLL_MS = 10_000;
const ONLY_ALLEGIANT_KEY = "shiftdeck.mapAllegiantOnly";

const isAllegiant = (plane: Plane) => /^AAY\d/.test(plane.callsign ?? "");

/** "G4854" (FlightAware) ↔ "AAY854" (ADS-B callsign). */
const callsignFor = (ident: string) => {
  const match = ident.match(/^G4(\d+)$/);
  return match ? `AAY${match[1]}` : ident;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const altitudeText = (plane: Plane) =>
  plane.ground ? "On ground" : plane.altitude !== null ? `${plane.altitude.toLocaleString()} ft` : "";

const planeIcon = (plane: Plane, highlight: boolean) => {
  const rotation = plane.track ?? 0;
  const label = plane.callsign ?? plane.registration ?? "";
  const alt = plane.ground ? "GND" : plane.altitude !== null ? `${Math.round(plane.altitude / 100)}` : "";
  return `
    <div class="map-plane ${highlight ? "allegiant" : ""} ${plane.ground ? "ground" : ""}">
      <svg viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)" aria-hidden="true">
        <path d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.4v2.1l-7.7-2.3v4.9l2.2 1.6v1.6L12 20.4l-3.5 1.1v-1.6l2.2-1.6v-4.9L3 15.7v-2.1l7.7-4.4V4c0-1.1.5-2 1.3-2z"/>
      </svg>
      ${label ? `<span>${escapeHtml(label)}${alt ? ` <small>${alt}</small>` : ""}</span>` : ""}
    </div>`;
};

export function LiveMapPanel({
  url,
  liveFlights,
}: {
  url: string;
  liveFlights: LiveFlight[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [planes, setPlanes] = useState<Plane[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [source, setSource] = useState<string>("adsb.lol");
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [allegiantOnly, setAllegiantOnly] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(ONLY_ALLEGIANT_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    const planeMarkers = markers.current;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(container.current, {
        center: [ABE.lat, ABE.lon],
        zoom: 9,
        zoomControl: false,
        attributionControl: true,
      });
      // OpenStreetMap's own tiles: free, no key, attribution required.
      // (CARTO's basemaps now need an API key.) Dark mode darkens them in CSS.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "map-tiles",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.marker([ABE.lat, ABE.lon], {
        icon: L.divIcon({ className: "", html: '<div class="map-airport">ABE</div>', iconSize: [36, 18], iconAnchor: [18, 30] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      L.circle([ABE.lat, ABE.lon], {
        radius: 9_260, // 5 nm ring
        color: "#6e93f0",
        weight: 1,
        opacity: 0.5,
        fill: false,
        dashArray: "4 6",
        interactive: false,
      }).addTo(map);
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      planeMarkers.clear();
    };
  }, []);

  // Only poll while the map is on screen and the app is open.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      threshold: 0.15,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(url, { cache: "no-store" });
          const data = (await response.json()) as {
            planes?: Plane[];
            updatedAt?: string;
            source?: string;
          };
          if (!cancelled && Array.isArray(data.planes)) {
            setPlanes(data.planes);
            setUpdatedAt(Date.parse(data.updatedAt ?? "") || Date.now());
            if (data.source) setSource(data.source);
            setFailed(false);
          } else if (!cancelled && !Array.isArray(data.planes)) {
            setFailed(true);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      }
      if (!cancelled) timer = window.setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onScreen, url]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Draw planes.
  const byCallsign = new Map(liveFlights.map((flight) => [callsignFor(flight.ident), flight]));
  const shown = (planes ?? []).filter((plane) => !allegiantOnly || isAllegiant(plane));
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const seen = new Set<string>();
    for (const plane of shown) {
      seen.add(plane.hex);
      const flight = plane.callsign ? byCallsign.get(plane.callsign) : undefined;
      const icon = L.divIcon({
        className: "",
        html: planeIcon(plane, isAllegiant(plane)),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const details = [
        `<b>${escapeHtml(plane.callsign ?? plane.registration ?? plane.hex.toUpperCase())}</b>`,
        flight
          ? `${flight.kind === "arrival" ? "From" : "To"} ${escapeHtml(flight.other[0] ?? "")}${
              flight.gate ? ` · Gate ${escapeHtml(flight.gate)}` : ""
            }`
          : "",
        [plane.type, plane.registration].filter(Boolean).map((part) => escapeHtml(part!)).join(" · "),
        [altitudeText(plane), plane.speed !== null ? `${plane.speed} kt` : ""].filter(Boolean).join(" · "),
      ]
        .filter(Boolean)
        .join("<br>");
      const existing = markers.current.get(plane.hex);
      if (existing) {
        existing.setLatLng([plane.lat, plane.lon]);
        existing.setIcon(icon);
        existing.setPopupContent(details);
      } else {
        const marker = L.marker([plane.lat, plane.lon], { icon, keyboard: false })
          .bindPopup(details, { closeButton: false, className: "map-popup" })
          .addTo(map);
        markers.current.set(plane.hex, marker);
      }
    }
    for (const [hex, marker] of markers.current) {
      if (!seen.has(hex)) {
        marker.remove();
        markers.current.delete(hex);
      }
    }
  });

  const setFilter = (next: boolean) => {
    setAllegiantOnly(next);
    try {
      localStorage.setItem(ONLY_ALLEGIANT_KEY, next ? "1" : "0");
    } catch {
      // Keep it for this visit only.
    }
  };

  const allegiantCount = (planes ?? []).filter(isAllegiant).length;
  const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;

  return (
    <section className="panel map-panel">
      <div className="panel-head">
        <h2>
          Live map <span className="count">{shown.length}</span>
        </h2>
        <div className="pill-toggle" role="group" aria-label="Which planes">
          <button type="button" className={!allegiantOnly ? "active" : ""} onClick={() => setFilter(false)}>
            All
          </button>
          <button type="button" className={allegiantOnly ? "active" : ""} onClick={() => setFilter(true)}>
            Allegiant {allegiantCount}
          </button>
        </div>
      </div>
      <div className="map-frame">
        <div ref={container} className="map-canvas" aria-label="Map of planes near ABE" />
        {!planes && (
          <p className="map-status">
            <Radar />
            {failed ? "Live planes unavailable right now" : "Finding planes…"}
          </p>
        )}
      </div>
      <p className="map-foot">
        <span>
          {failed && planes
            ? "Couldn’t update · showing last positions"
            : age !== null
              ? `Updated ${age < 5 ? "just now" : `${age}s ago`} · within 35 nm`
              : "Planes within 35 nm of ABE"}
        </span>
        <span>ADS-B data: {source}</span>
      </p>
    </section>
  );
}
