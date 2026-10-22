import { useAui, useAuiState } from "@assistant-ui/react";
import {
  ChevronDownIcon, ClapperboardIcon, ImageIcon, MusicIcon, PlusIcon, RectangleHorizontalIcon, RectangleVerticalIcon,
  MonitorIcon, SquareIcon, TagIcon, TimerIcon, TypeIcon, UploadIcon, Volume2Icon, VolumeXIcon, XIcon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DURATIONS, FORMATS, FPS, QUALITIES, STYLES, musicChoice, setSettings, useCaptured, useLibrary, useSettings, type Format, type Settings } from "./settings";

const FormatIcon = ({ f, className }: { f: Format; className?: string }) =>
  f === "9:16" || f === "4:5" ? <RectangleVerticalIcon className={className} /> : f === "1:1" ? <SquareIcon className={className} /> : <RectangleHorizontalIcon className={className} />;

const pill =
  "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] data-[popup-open]:bg-foreground/[0.06] inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium transition-colors outline-none";

function useApply() {
  const aui = useAui();
  const captured = useCaptured();
  const running = useAuiState((s) => s.thread.isRunning);
  return (patch: Partial<Settings>, say: string) => {
    setSettings(patch);
    if (captured && !running) aui.thread.append(say);
  };
}

export function ComposerPlusMenu() {
  const aui = useAui();
  const s = useSettings();
  const logoRef = useRef<HTMLInputElement>(null), musicRef = useRef<HTMLInputElement>(null);
  const prefill = (text: string) => {
    aui.composer.setText(text);

    requestAnimationFrame(() => {
      const el = document.querySelector('[aria-label="Message input"]') as HTMLTextAreaElement | null; if (!el) return;
      el.focus(); el.setSelectionRange(text.indexOf(":") + 2, el.value.length);
    });
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) void aui.composer.addAttachment(f); e.target.value = "";
  };
  return (
    <>
      <input ref={logoRef} type="file" accept="image/*" hidden onChange={pick} />
      <input ref={musicRef} type="file" accept="audio/*" hidden onChange={pick} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<button type="button" aria-label="Add" className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] data-[popup-open]:bg-foreground/[0.06] inline-flex size-7 items-center justify-center rounded-full transition-colors outline-none" />}>
          <PlusIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Add to the video</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => logoRef.current?.click()}><ImageIcon /> Logo…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => musicRef.current?.click()}><MusicIcon /> Music track…</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Closing card</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => prefill(`headline: ${s.line1}`)}><TypeIcon /> Headline</DropdownMenuItem>
            <DropdownMenuItem onClick={() => prefill(`tail: ${s.tail}`)}><TypeIcon className="italic" /> Second line</DropdownMenuItem>
            <DropdownMenuItem onClick={() => prefill(`brand: ${s.brand}`)}><TagIcon /> Brand name</DropdownMenuItem>
          </DropdownMenuGroup>
          {s.track && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => aui.thread.append("no music")}><XIcon /> Remove music</DropdownMenuItem></>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function Pill({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={pill} />}>
        {icon}{label}<ChevronDownIcon className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function MusicPill() {
  const s = useSettings(), lib = useLibrary(), apply = useApply(), aui = useAui();
  const fileRef = useRef<HTMLInputElement>(null);
  const choice = musicChoice(s);
  const label = choice === "mute" ? "Muted" : choice === "custom" ? (s.trackName ?? "Your track") : choice === "fx" ? "Effects" : lib.find((t) => t.id === choice)?.name ?? "Music";
  const pickTrack = (v: string) => {
    if (v === "mute") apply({ sound: false }, "no sound");
    else if (v === "fx") apply({ sound: true, music: "", track: null, trackName: null }, "effects only");
    else if (v === "custom") fileRef.current?.click();
    else { const t = lib.find((x) => x.id === v); apply({ sound: true, music: v, track: null, trackName: null }, `music: ${t?.name ?? v}`); }
  };
  return (
    <>
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void aui.composer.addAttachment(f); e.target.value = ""; }} />
      <Pill icon={choice === "mute" ? <VolumeXIcon className="size-3.5" /> : choice === "fx" ? <Volume2Icon className="size-3.5" /> : <MusicIcon className="size-3.5" />} label={label}>
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => pickTrack(v as string)}>
          <DropdownMenuLabel>Music</DropdownMenuLabel>
          {lib.map((t) => (
            <DropdownMenuRadioItem closeOnClick key={t.id} value={t.id}>
              {t.name} <span className="text-muted-foreground ml-auto text-xs">{t.mood}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem closeOnClick value="fx">Effects only <span className="text-muted-foreground ml-auto text-xs">no music</span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem closeOnClick value="mute">No sound</DropdownMenuRadioItem>
          <DropdownMenuRadioItem closeOnClick value="custom"><UploadIcon className="size-3.5" /> {s.track ? s.trackName : "Upload your own…"}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </Pill>
    </>
  );
}

export function ComposerSettings() {
  const s = useSettings();
  const apply = useApply();
  const fmt = FORMATS.find((f) => f.value === s.format)!;
  return (
    <div className="flex items-center gap-0.5">
      <Pill icon={<FormatIcon f={s.format} className="size-3.5" />} label={fmt.label}>
        <DropdownMenuRadioGroup value={s.format} onValueChange={(v) => apply({ format: v as Format }, `format ${v}`)}>
          <DropdownMenuLabel>Format</DropdownMenuLabel>
          {FORMATS.map((f) => (
            <DropdownMenuRadioItem closeOnClick key={f.value} value={f.value}>
              <FormatIcon f={f.value} className="size-3.5" /> {f.label} <span className="text-muted-foreground ml-auto text-xs">{f.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </Pill>
      <Pill icon={<TimerIcon className="size-3.5" />} label={s.duration ? `${s.duration} s` : "Auto"}>
        <DropdownMenuRadioGroup value={s.duration} onValueChange={(v) => apply({ duration: v as string }, v ? `${v} seconds` : "automatic length")}>
          <DropdownMenuLabel>Length</DropdownMenuLabel>
          {DURATIONS.map((d) => <DropdownMenuRadioItem closeOnClick key={d || "auto"} value={d}>{d ? `${d} seconds` : "Automatic"}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </Pill>
      <Pill icon={<ClapperboardIcon className="size-3.5" />} label={STYLES.find((x) => x.value === s.style)!.label}>
        <DropdownMenuRadioGroup value={s.style} onValueChange={(v) => apply({ style: v as Settings["style"] }, `${v === "default" ? "standard" : v} camera`)}>
          <DropdownMenuLabel>Camera</DropdownMenuLabel>
          {STYLES.map((x) => <DropdownMenuRadioItem closeOnClick key={x.value} value={x.value}>{x.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </Pill>
      <MusicPill />
      <Pill icon={<MonitorIcon className="size-3.5" />} label={`${s.quality}p · ${s.fps}fps`}>
        <DropdownMenuRadioGroup value={s.quality} onValueChange={(v) => apply({ quality: v as Settings["quality"] }, `${v}p`)}>
          <DropdownMenuLabel>Quality</DropdownMenuLabel>
          {QUALITIES.map((q) => (
            <DropdownMenuRadioItem closeOnClick key={q.value} value={q.value}>
              {q.label} <span className="text-muted-foreground ml-auto text-xs">{q.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={s.fps} onValueChange={(v) => apply({ fps: v as Settings["fps"] }, `${v} fps`)}>
          <DropdownMenuLabel>Frame rate</DropdownMenuLabel>
          {FPS.map((f) => (
            <DropdownMenuRadioItem closeOnClick key={f.value} value={f.value}>
              {f.label} <span className="text-muted-foreground ml-auto text-xs">{f.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </Pill>
    </div>
  );
}
