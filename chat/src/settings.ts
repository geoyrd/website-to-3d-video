import { useSyncExternalStore } from "react";

export type Format = "5:4" | "16:9" | "9:16" | "1:1" | "4:5";
export type Style = "calm" | "default" | "energetic";
export type Settings = {
  brand: string;
  logo: string | null;
  line1: string;
  tail: string;
  format: Format;
  duration: string;
  style: Style;
  sound: boolean;
  track: string | null;
  trackName: string | null;
  music: string;
  quality: "720" | "1080" | "1440";
  fps: "24" | "30" | "60";
};
export type Track = { id: string; name: string; mood: string; artist: string; url: string };

export const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: "5:4", label: "5:4", hint: "Landscape" },
  { value: "16:9", label: "16:9", hint: "Widescreen" },
  { value: "9:16", label: "9:16", hint: "Reels, TikTok" },
  { value: "1:1", label: "1:1", hint: "Square" },
  { value: "4:5", label: "4:5", hint: "Instagram feed" },
];
export const DURATIONS = ["", "10", "15", "20", "30"];
export const STYLES: { value: Style; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "default", label: "Standard" },
  { value: "energetic", label: "Energetic" },
];

export const QUALITIES: { value: Settings["quality"]; label: string; hint: string }[] = [
  { value: "720", label: "720p", hint: "HD · fastest" },
  { value: "1080", label: "1080p", hint: "Full HD" },
  { value: "1440", label: "1440p", hint: "2K · slowest" },
];
export const FPS: { value: Settings["fps"]; label: string; hint: string }[] = [
  { value: "24", label: "24 fps", hint: "Cinematic" },
  { value: "30", label: "30 fps", hint: "Standard" },
  { value: "60", label: "60 fps", hint: "Smoothest" },
];

let state: Settings = { brand: "", logo: null, line1: "", tail: "", format: "5:4", duration: "", style: "default", sound: true, track: null, trackName: null,
  music: "", quality: "720", fps: "30" };

let library: Track[] = [];
const libListeners = new Set<() => void>();
export const getLibrary = () => library;
export const loadLibrary = () => fetch("/api/music", { method: "POST", body: "{}" }).then((r) => r.json()).then((l: Track[]) => { library = l; libListeners.forEach((f) => f()); });
export const useLibrary = () => useSyncExternalStore((l) => { libListeners.add(l); return () => libListeners.delete(l); }, () => library);

export const musicChoice = (s: Settings) => (!s.sound ? "mute" : s.track ? "custom" : s.music || "fx");
const listeners = new Set<() => void>();
export const getSettings = () => state;
export const setSettings = (patch: Partial<Settings>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const useSettings = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);

let captured = false;
const capListeners = new Set<() => void>();
export const setCaptured = (v: boolean) => { captured = v; capListeners.forEach((l) => l()); };
export const useCaptured = () => useSyncExternalStore((l) => { capListeners.add(l); return () => capListeners.delete(l); }, () => captured);
