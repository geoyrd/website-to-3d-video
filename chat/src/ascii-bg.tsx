import { useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

const GLYPHS = " .·:-=+*%#@";
const CELL = 14;

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec2 uRes, uMouse, uTrail; uniform float uTime, uCell, uDpr, uGlyphs, uEnergy, uColHalf, uMouseOn;
uniform vec3 uInk, uAccent;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * n(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float cs = uCell * uDpr;
  vec2 cell = floor(frag / cs), c = (cell + .5) * cs, uv = fract(frag / cs);
  vec2 q = c / (cs * 18.);
  float t = uTime * (0.035 + 0.05 * uEnergy);

  vec2 w = vec2(fbm(q + vec2(0., t)), fbm(q + vec2(5.2, -t)));
  float v = fbm(q * 1.3 + 2.2 * w + vec2(t * .6, 0.));
  v = smoothstep(.30, .78, v);

  float dm = length(c - uMouse) / uDpr, dt = length(c - uTrail) / uDpr;
  float wake = exp(-dt / 150.) * .85 * uMouseOn;
  float ring = exp(-dm / 240.) * (.5 + .5 * sin(dm * .05 - uTime * 2.4)) * .5 * uMouseOn;
  v = clamp(v + wake + ring, 0., 1.);

  float x = abs(c.x - uRes.x * .5) / uDpr;
  float side = smoothstep(uColHalf * .85, uColHalf * 1.35, x);
  float vy = c.y / uRes.y;
  float edgeY = smoothstep(0., .12, vy) * (1. - smoothstep(.78, 1., vy));
  float strength = mix(.22, 1., side) * edgeY;

  float gi = floor(v * (uGlyphs - 1.) + .5);
  vec2 auv = vec2((gi + uv.x) / uGlyphs, uv.y);
  float a = texture(uAtlas, auv).r;
  float glow = clamp(wake + ring, 0., 1.);
  float alpha = a * strength * (.08 + .12 * v + .26 * glow);
  vec3 col = mix(uInk, uAccent, smoothstep(.15, .8, glow) * .85);
  o = vec4(col * alpha, alpha);
}`;

function atlas(gl: WebGL2RenderingContext) {
  const size = 64, cv = document.createElement("canvas");
  cv.width = size * GLYPHS.length; cv.height = size;
  const x = cv.getContext("2d")!;
  x.fillStyle = "#000"; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = "#fff"; x.font = `500 ${size * 0.72}px ui-monospace, "SF Mono", Menlo, monospace`;
  x.textAlign = "center"; x.textBaseline = "middle";
  [...GLYPHS].forEach((g, i) => x.fillText(g, i * size + size / 2, size / 2 + 2));
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cv.width, cv.height, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(x.getImageData(0, 0, cv.width, cv.height).data.filter((_, i) => i % 4 === 0)));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  return tex;
}

export function AsciiBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const running = useAuiState((s) => s.thread.isRunning);
  const runRef = useRef(false);
  runRef.current = running;

  useEffect(() => {
    const cv = ref.current!; const gl = cv.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram()!; gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); atlas(gl);
    const U = (n: string) => gl.getUniformLocation(pr, n);
    gl.uniform1i(U("uAtlas"), 0); gl.uniform1f(U("uGlyphs"), GLYPHS.length); gl.uniform1f(U("uCell"), CELL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const dark = () => document.documentElement.classList.contains("dark");
    let dpr = 1, W = 0, H = 0;
    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1); W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
      cv.width = W; cv.height = H; gl.viewport(0, 0, W, H);
    };
    resize(); addEventListener("resize", resize);

    const mouse = { x: -1e4, y: -1e4 }, trail = { x: -1e4, y: -1e4 }; let mouseOn = 0, mouseTarget = 0;
    const move = (e: PointerEvent) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; if (trail.x < -1e3) { trail.x = mouse.x; trail.y = mouse.y; } mouseTarget = 1; };
    const leave = () => { mouseTarget = 0; };
    addEventListener("pointermove", move); document.addEventListener("pointerleave", leave);

    let raf = 0, last = 0, energy = 0; const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 40) return;
      const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      trail.x += (mouse.x - trail.x) * Math.min(1, dt * 3.5); trail.y += (mouse.y - trail.y) * Math.min(1, dt * 3.5);
      mouseOn += (mouseTarget - mouseOn) * Math.min(1, dt * 2);
      energy += ((runRef.current ? 1 : 0) - energy) * Math.min(1, dt * 1.2);
      const t = reduce.matches ? 12 : (now - t0) / 1000;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U("uRes"), W, H); gl.uniform1f(U("uDpr"), dpr); gl.uniform1f(U("uTime"), t);
      gl.uniform2f(U("uMouse"), mouse.x, mouse.y); gl.uniform2f(U("uTrail"), trail.x, trail.y); gl.uniform1f(U("uMouseOn"), reduce.matches ? 0 : mouseOn);
      gl.uniform1f(U("uEnergy"), energy); gl.uniform1f(U("uColHalf"), Math.min(innerWidth, 704) / 2);
      const ink = dark() ? [0.92, 0.93, 0.95] : [0.08, 0.09, 0.11];
      gl.uniform3f(U("uInk"), ink[0], ink[1], ink[2]); gl.uniform3f(U("uAccent"), 0.23, 0.36, 0.95);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", vis); raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave); document.removeEventListener("visibilitychange", vis); };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
