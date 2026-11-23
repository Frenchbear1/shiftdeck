"use client";

import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

/** A small, still map of the shift location's pin (Shift details → Location). */
export function PlacePreview({ latitude, longitude }: { latitude: number; longitude: number }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  // Built on the first pin; later pins glide there.
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      markerRef.current?.setLatLng([latitude, longitude]);
      map.setView([latitude, longitude], map.getZoom(), { animate: true });
      return;
    }
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || mapRef.current) return;
      const built = L.map(container.current, {
        center: [latitude, longitude],
        zoom: 15,
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        boxZoom: false,
        keyboard: false,
        fadeAnimation: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "map-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(built);
      markerRef.current = L.marker([latitude, longitude], {
        icon: L.divIcon({ className: "", html: '<div class="place-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }),
        interactive: false,
        keyboard: false,
      }).addTo(built);
      mapRef.current = built;
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    },
    [],
  );

  return <div className="place-map" ref={container} aria-hidden="true" />;
}
