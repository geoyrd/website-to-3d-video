import { defineToolkit } from "@assistant-ui/react";
import { DownloadIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="border-foreground/10 bg-background/90 my-2 rounded-xl border p-3 text-sm backdrop-blur-sm">{children}</div>
);
const Err = ({ msg }: { msg: string }) => (
  <Card><div className="flex items-center gap-2 text-red-600"><TriangleAlertIcon className="size-4" /> {msg}</div></Card>
);

function Stills({ images, w, h }: { images: string[]; w: number; h: number }) {
  const [big, setBig] = useState<string | null>(null);
  const tall = h > w;
  return (
    <>
      <div className={tall ? "grid grid-cols-5 gap-1.5" : "grid grid-cols-3 gap-1.5"}>
        {images.map((src, i) => (
          <button key={src} type="button" onClick={() => setBig(src)}
            className={`overflow-hidden rounded-lg border border-black/5 bg-white ${!tall && i >= 3 ? "col-span-1" : ""}`}>
            <img src={"/" + src} alt="" className="block w-full" style={{ aspectRatio: `${w} / ${h}`, objectFit: "cover" }} />
          </button>
        ))}
      </div>
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setBig(null)}>
          <img src={"/" + big} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  );
}

export const toolkit = defineToolkit({
  capture: {
    type: "backend",
    display: "standalone",
    render: ({ args, result }) => {
      const r = result as { error?: string } | undefined;
      if (r?.error) return <Err msg={`Couldn't capture the page: ${r.error}`} />;
      if (r) return null;
      return (
        <Card>
          <div className="flex items-center gap-2">
            <LoaderIcon className="size-4 animate-spin" />
            <span className="font-medium">{String(args.progress ?? "Capturing the page…")}</span>
          </div>
        </Card>
      );
    },
  },
  preview: {
    type: "backend",
    display: "standalone",
    render: ({ result }) => {
      const r = result as { images: string[]; seconds: number; w: number; h: number; error?: string } | undefined;
      if (r?.error) return <Err msg={`Preview failed: ${r.error}`} />;
      if (!r) return <Card><div className="flex items-center gap-2"><LoaderIcon className="size-4 animate-spin" /> Rendering a preview…</div></Card>;
      return (
        <Card>
          <Stills images={r.images} w={r.w} h={r.h} />
          <div className="text-muted-foreground mt-2">Preview · {r.seconds.toFixed(1)} s video · tap a frame to enlarge</div>
        </Card>
      );
    },
  },
  render: {
    type: "backend",
    display: "standalone",
    render: ({ args, result }) => {
      const r = result as { video: string; secs: number; error?: string } | undefined;
      if (r?.error) return <Err msg={`Render failed: ${r.error}`} />;
      if (r) {
        const file = r.video.split("?")[0];
        return (
          <Card>
            <video src={"/" + r.video} controls playsInline className="mx-auto block max-h-[60vh] w-auto max-w-full rounded-lg bg-black" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Rendered in {Math.round(r.secs)} s</span>
              <a href={"/" + file} download className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white">
                <DownloadIcon className="size-3.5" /> Download MP4
              </a>
            </div>
          </Card>
        );
      }
      const p = Number(args.progress ?? 0);
      return (
        <Card>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2"><LoaderIcon className="size-4 animate-spin" /> {String(args.stage ?? "Rendering…")}</span>
            <span className="text-muted-foreground tabular-nums">{Math.round(p * 100)}%{args.elapsed ? ` · ${args.elapsed} s` : ""}</span>
          </div>
          <div className="bg-foreground/10 mt-2 h-1.5 overflow-hidden rounded-full">
            <div className="h-full rounded-full bg-black transition-[width] duration-500" style={{ width: `${Math.max(2, p * 100)}%` }} />
          </div>
        </Card>
      );
    },
  },
});
