import cv2, numpy as np, json, subprocess, sys, math
cap = cv2.VideoCapture(sys.argv[1]); fps = cap.get(cv2.CAP_PROP_FPS)
dump = json.loads(subprocess.check_output(['node', 'camdump.mjs', str(fps)])); cam = dump['cams']; K = dump['K']
EXT = 5.7 * (K - 1); CR1 = 7.25 + EXT
prev = None; rows = []; i = 0
mask = np.zeros((1152, 1440), np.uint8); mask[250:900, 60:1380] = 255
while True:
    ok, f = cap.read()
    if not ok: break
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    if prev is not None:
        p0 = cv2.goodFeaturesToTrack(prev, 600, 0.01, 8, mask=mask)
        if p0 is not None and len(p0) > 20:
            p1, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, p0, None, winSize=(31, 31), maxLevel=4)
            a, b = p0[st == 1], p1[st == 1]
            M, inl = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=1.5)
            scale = math.hypot(M[0, 0], M[1, 0]) if M is not None else 1
            t = i / fps; d = cam[i]['d']; th = math.radians(cam[i]['th']); c, sn = math.cos(th), math.sin(th)
            Y = a[:, 1] - 576; aa = Y * d / (1880 * c + sn * Y)
            dYda = 1880 * c * d / (d - sn * aa) ** 2
            pv = -(b[:, 1] - a[:, 1]) * fps / dYda
            v = np.median(pv[np.abs(Y) < 300]) if (np.abs(Y) < 300).sum() > 5 else np.nan
            rows.append((t, v, (scale - 1) * fps))
    prev = g; i += 1
R = np.array(rows)
cr = R[(R[:, 0] > 1.7) & (R[:, 0] < CR1)]; s = cr[~np.isnan(cr[:, 1])]
med = np.median(s[:, 1]); smv = np.convolve(s[:, 1], np.ones(5) / 5, mode='valid')
print(f"cruise (1.7-{CR1:.2f}s) page speed: median {med:.0f} px/s  smoothed min {smv.min():.0f}  max {smv.max():.0f}  (K {K:.2f})")
dips = [round(s[j + 2, 0], 2) for j in range(len(smv)) if smv[j] < 0.92 * med]
print("dips below 92%:", dips if dips else "none")
fl = R[R[:, 0] < 7.75 + EXT]
print(f"flight zoom rate (+ = zoom-in): max {np.nanmax(fl[:,2]):+.3f}/s, frames > +0.02/s: {[round(x,2) for x in fl[fl[:,2] > 0.02, 0]]}")
print("speed curve:", " ".join(f"{t:.1f}:{v:.0f}" for t, v, _ in R[::6] if t < 8.4 + EXT))
np.savetxt('out/flow.csv', R, delimiter=',', header='t,page_v,zoom_rate', fmt='%.4f')
