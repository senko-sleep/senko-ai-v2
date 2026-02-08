"use client";

import { useState, useCallback } from "react";
import type { LocationInfo } from "@/types/chat";

const defaultLocation: LocationInfo = {
  latitude: null,
  longitude: null,
  accuracy: null,
  status: "prompt",
};

export function useLocation() {
  const [location, setLocation] = useState<LocationInfo>(defaultLocation);
  const [loading, setLoading] = useState(false);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocation({ ...defaultLocation, status: "unavailable" });
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          status: "granted",
        });
        setLoading(false);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocation({ ...defaultLocation, status: "denied" });
        } else {
          setLocation({ ...defaultLocation, status: "unavailable" });
        }
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  return { location, loading, requestLocation };
}
