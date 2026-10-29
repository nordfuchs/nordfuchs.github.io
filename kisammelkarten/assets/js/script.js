(() => {
  "use strict";

  const gallery = document.getElementById("gallery");
  const sortToggle = document.getElementById("sort-toggle");
  if (!gallery) return;

  const CFG = {
    previewWidth: 32,
    previewMaxHeight: 46,
    paletteSize: 5,
    regionalPaletteSize: 4,
    kMeansIterations: 6,
    maxWorkers: 4,
    minChromaticChroma: 12,
    neutralColorMassThreshold: 0.13,
    fullPaletteWeight: 0.62,
    centerPaletteWeight: 0.25,
    edgePaletteWeight: 0.13,
    hueTransitionWeight: 0.10,
    lightnessTransitionWeight: 0.035,
    chromaTransitionWeight: 0.022,
    hueBacktrackPenalty: 0.72,
    optimizationPasses: 2,
    relocateWindow: 5,
    reversalWindow: 9,
    improvementEpsilon: 0.015
  };

  const LABELS = {
    random: "Nach Datum sortieren",
    date: "Nach Farben sortieren",
    color: "Zufällig sortieren"
  };

  let sourceCards = [];
  let sortMode = "random";
  let colorSortBusy = false;

  const descriptorCache = new Map();
  const pairDistanceCache = new Map();

  // ============================================================
  // 1. ALLGEMEINE GALERIE-FUNKTIONEN
  // ============================================================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getNumber(card) {
    return card.Nummer == null ? "" : String(card.Nummer).trim();
  }

  function imageCandidates(number) {
    const n = String(number ?? "").trim();
    return n ? [`assets/jpg/${n}.jpg`] : [];
  }

  function isUnavailable(card) {
    return String(card["Noch zu haben"] ?? "ja")
      .trim()
      .toLocaleLowerCase("de-DE") === "nein";
  }

  function setImage(image, candidates, index, name) {
    if (index >= candidates.length) {
      const fallback = el("div", "image-fallback");

      fallback.append(
        el("strong", "", "Bild nicht gefunden"),
        el(
          "span",
          "",
          `Erwartet wird eine Bilddatei wie ${
            candidates[0] || "name.jpg"
          }.`
        )
      );

      image.replaceWith(fallback);
      return;
    }

    image.src = candidates[index];
    image.alt = name;

    image.onerror = () => {
      setImage(image, candidates, index + 1, name);
    };
  }

  function makeCard(card) {
    const number = getNumber(card);

    const name = String(
      card.Name ||
      (number ? `Karte ${number}` : "Unbenannte Karte")
    ).trim();

    const story = String(
      card["Background-Story"] ||
      "Für diese Karte wurde noch keine Background-Story hinterlegt."
    ).trim();

    const unavailable = isUnavailable(card);

    const article = el(
      "article",
      `card-item${unavailable ? " is-unavailable" : ""}`
    );

    const scene = el("button", "card-scene");

    scene.type = "button";

    scene.setAttribute("aria-pressed", "false");

    scene.setAttribute(
      "aria-label",
      `${name}: in Vollbild öffnen${
        unavailable ? " (nicht mehr verfügbar)" : ""
      }`
    );

    const inner = el("span", "card-inner");
    const front = el("span", "card-face card-front");

    front.setAttribute("aria-hidden", "false");

    const image = document.createElement("img");

    image.loading = "lazy";
    image.decoding = "async";
    image.width = 500;
    image.height = 700;

    setImage(
      image,
      imageCandidates(number),
      0,
      name
    );

    front.appendChild(image);

    const badge = el(
      "span",
      "availability-badge",
      "Nicht verfügbar"
    );

    badge.setAttribute(
      "aria-hidden",
      unavailable ? "false" : "true"
    );

    front.appendChild(badge);

    const back = el("span", "card-face card-back");

    back.setAttribute("aria-hidden", "true");

    back.append(
      el("span", "back-title", name),
      el("span", "back-rule"),
      el("span", "back-content", story)
    );

    const footer = el("span", "back-footer");

    footer.append(
      el(
        "span",
        "back-status",
        unavailable ? "Nicht verfügbar" : "Noch zu haben"
      ),
      el(
        "span",
        "back-number",
        number ? `Nr. ${number}` : "Nummer offen"
      )
    );

    back.appendChild(footer);

    inner.append(front, back);
    scene.appendChild(inner);
    article.appendChild(scene);

    const caption = el("div", "card-caption");

    caption.append(
      el("strong", "", name),
      el(
        "span",
        "card-number",
        number ? `Nr. ${number}` : "Nummer offen"
      )
    );

    article.appendChild(caption);

    // Der Karten-Flip bleibt deaktiviert.
    // modal.js verarbeitet den Klick auf .card-scene.

    return article;
  }

  function showMessage(message, isError = false) {
    gallery.replaceChildren(
      el(
        "p",
        `status-message${isError ? " is-error" : ""}`,
        message
      )
    );

    gallery.setAttribute("aria-busy", "false");
  }

  // ============================================================
  // 2. ZUFALL UND DATUMSSORTIERUNG
  // ============================================================

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }

  function renderCards(cards) {
    const fragment = document.createDocumentFragment();

    cards.forEach((card) => {
      fragment.appendChild(makeCard(card));
    });

    gallery.replaceChildren(fragment);
    gallery.setAttribute("aria-busy", "false");
  }

  function sortByFilenameDescending(cards) {
    return [...cards].sort((a, b) =>
      `${getNumber(b)}.jpg`.localeCompare(
        `${getNumber(a)}.jpg`,
        "de",
        {
          numeric: true,
          sensitivity: "base"
        }
      )
    );
  }

  function updateSortButton() {
    if (sortToggle) {
      sortToggle.textContent = LABELS[sortMode];
    }
  }

  // ============================================================
  // 3. FARBUMRECHNUNG
  //
  // sRGB -> CIELAB mit Referenzweiß D65.
  //
  // CIELAB beschreibt:
  // L* = Helligkeit
  // a* = Grün-Rot-Achse
  // b* = Blau-Gelb-Achse
  // ============================================================

  function srgbToLinear(value) {
    value /= 255;

    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(red, green, blue) {
    const r = srgbToLinear(red);
    const g = srgbToLinear(green);
    const b = srgbToLinear(blue);

    const x = (
      0.4124564 * r +
      0.3575761 * g +
      0.1804375 * b
    ) / 0.95047;

    const y =
      0.2126729 * r +
      0.7151522 * g +
      0.0721750 * b;

    const z = (
      0.0193339 * r +
      0.1191920 * g +
      0.9503041 * b
    ) / 1.08883;

    const delta = 6 / 29;
    const delta3 = delta * delta * delta;

    const f = (v) =>
      v > delta3
        ? Math.cbrt(v)
        : v / (3 * delta * delta) + 4 / 29;

    const fx = f(x);
    const fy = f(y);
    const fz = f(z);

    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz)
    };
  }

  function hueAngle(a, b) {
    return (
      Math.atan2(b, a) * 180 / Math.PI + 360
    ) % 360;
  }

  function circularHueDifference(hueA, hueB) {
    const difference = Math.abs(hueA - hueB) % 360;

    return Math.min(
      difference,
      360 - difference
    );
  }

  // ============================================================
  // 4. CIEDE2000
  //
  // Wahrnehmungsorientierte Farbunterschiedsformel.
  // Verwendet die Standardparameter kL = kC = kH = 1.
  // ============================================================

  function deltaE2000(p, q) {
    const L1 = p.L;
    const a1 = p.a;
    const b1 = p.b;

    const L2 = q.L;
    const a2 = q.a;
    const b2 = q.b;

    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);

    const Cbar = (C1 + C2) / 2;

    const Cbar7 = Math.pow(Cbar, 7);
    const twentyFive7 = Math.pow(25, 7);

    const G = 0.5 * (
      1 - Math.sqrt(
        Cbar7 / (Cbar7 + twentyFive7)
      )
    );

    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;

    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);

    const h1p = C1p < 1e-12
      ? 0
      : hueAngle(a1p, b1);

    const h2p = C2p < 1e-12
      ? 0
      : hueAngle(a2p, b2);

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp = 0;

    if (C1p * C2p >= 1e-12) {
      dhp = h2p - h1p;

      if (dhp > 180) dhp -= 360;
      if (dhp < -180) dhp += 360;
    }

    const dHp =
      2 * Math.sqrt(C1p * C2p) *
      Math.sin((dhp * Math.PI / 180) / 2);

    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;

    let hbarp;

    if (C1p * C2p < 1e-12) {
      hbarp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) <= 180) {
      hbarp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      hbarp = (h1p + h2p + 360) / 2;
    } else {
      hbarp = (h1p + h2p - 360) / 2;
    }

    const rad = (degrees) =>
      degrees * Math.PI / 180;

    const T =
      1
      - 0.17 * Math.cos(rad(hbarp - 30))
      + 0.24 * Math.cos(rad(2 * hbarp))
      + 0.32 * Math.cos(rad(3 * hbarp + 6))
      - 0.20 * Math.cos(rad(4 * hbarp - 63));

    const deltaTheta = 30 * Math.exp(
      -Math.pow((hbarp - 275) / 25, 2)
    );

    const Cbarp7 = Math.pow(Cbarp, 7);

    const RC = 2 * Math.sqrt(
      Cbarp7 / (Cbarp7 + twentyFive7)
    );

    const Ldiff = Lbarp - 50;

    const SL = 1 + (
      0.015 * Ldiff * Ldiff
    ) / Math.sqrt(20 + Ldiff * Ldiff);

    const SC = 1 + 0.045 * Cbarp;
    const SH = 1 + 0.015 * Cbarp * T;

    const RT = -Math.sin(rad(2 * deltaTheta)) * RC;

    const lTerm = dLp / SL;
    const cTerm = dCp / SC;
    const hTerm = dHp / SH;

    return Math.sqrt(Math.max(
      0,
      lTerm * lTerm +
      cTerm * cTerm +
      hTerm * hTerm +
      RT * cTerm * hTerm
    ));
  }

  // ============================================================
  // 5. REPRÄSENTATIVE FARBPALETTEN
  //
  // Gewichtetes K-Means gruppiert ähnliche Bildfarben. Jede
  // repräsentative Farbe erhält einen Anteil an der Bildfläche.
  // ============================================================

  function seededRandom(text) {
    let seed = 2166136261;

    for (let i = 0; i < text.length; i++) {
      seed ^= text.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    let state = seed >>> 0;

    return () => {
      state += 0x6D2B79F5;

      let t = state;

      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

      return (
        (t ^ (t >>> 14)) >>> 0
      ) / 4294967296;
    };
  }

  function labDistanceSquared(a, b) {
    const dL = a.L - b.L;
    const da = a.a - b.a;
    const db = a.b - b.b;

    return dL * dL + da * da + db * db;
  }

  function weightedPick(points, weights, totalWeight, random) {
    if (totalWeight <= 0) {
      return points[
        Math.floor(random() * points.length)
      ];
    }

    let threshold = random() * totalWeight;

    for (let i = 0; i < points.length; i++) {
      threshold -= weights[i];

      if (threshold <= 0) {
        return points[i];
      }
    }

    return points[points.length - 1];
  }

  function buildPalette(
    points,
    seedText,
    requestedSize = CFG.paletteSize
  ) {
    if (!points.length) {
      return failedDescriptor();
    }

    const k = Math.min(requestedSize, points.length);
    const random = seededRandom(seedText);

    const pointWeights = points.map(
      (point) => point.weight
    );

    const totalPointWeight = pointWeights.reduce(
      (sum, weight) => sum + weight,
      0
    );

    const centers = [
      weightedPick(
        points,
        pointWeights,
        totalPointWeight,
        random
      )
    ];

    // K-Means++-artige Initialisierung:
    // Farben mit größerem Abstand werden bevorzugt.
    while (centers.length < k) {
      const weights = new Array(points.length);
      let total = 0;

      for (let i = 0; i < points.length; i++) {
        let nearest = Infinity;

        for (const center of centers) {
          nearest = Math.min(
            nearest,
            labDistanceSquared(points[i], center)
          );
        }

        weights[i] = nearest * pointWeights[i];
        total += weights[i];
      }

      if (total < 1e-9) break;

      centers.push(
        weightedPick(points, weights, total, random)
      );
    }

    for (
      let iteration = 0;
      iteration < CFG.kMeansIterations;
      iteration++
    ) {
      const sums = centers.map(() => ({
        w: 0,
        L: 0,
        a: 0,
        b: 0
      }));

      for (let i = 0; i < points.length; i++) {
        const point = points[i];

        let best = 0;
        let bestDistance = Infinity;

        for (let c = 0; c < centers.length; c++) {
          const d = labDistanceSquared(point, centers[c]);

          if (d < bestDistance) {
            bestDistance = d;
            best = c;
          }
        }

        const w = point.weight;
        const target = sums[best];

        target.w += w;
        target.L += point.L * w;
        target.a += point.a * w;
        target.b += point.b * w;
      }

      for (let c = 0; c < centers.length; c++) {
        if (sums[c].w > 0) {
          centers[c] = {
            L: sums[c].L / sums[c].w,
            a: sums[c].a / sums[c].w,
            b: sums[c].b / sums[c].w
          };
        }
      }
    }

    // Endgültige Clustergewichte erneut berechnen.
    const sums = centers.map(() => ({
      w: 0,
      L: 0,
      a: 0,
      b: 0
    }));

    for (const point of points) {
      let best = 0;
      let bestDistance = Infinity;

      for (let c = 0; c < centers.length; c++) {
        const d = labDistanceSquared(point, centers[c]);

        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }

      const target = sums[best];
      const w = point.weight;

      target.w += w;
      target.L += point.L * w;
      target.a += point.a * w;
      target.b += point.b * w;
    }

    const totalWeight = sums.reduce(
      (sum, cluster) => sum + cluster.w,
      0
    ) || 1;

    const palette = sums
      .filter((cluster) => cluster.w > 0)
      .map((cluster) => {
        const lab = {
          L: cluster.L / cluster.w,
          a: cluster.a / cluster.w,
          b: cluster.b / cluster.w
        };

        const chroma = Math.hypot(lab.a, lab.b);

        return {
          ...lab,
          chroma,
          hue: chroma < 1e-6
            ? null
            : hueAngle(lab.a, lab.b),
          weight: cluster.w / totalWeight
        };
      })
      .sort((a, b) => b.weight - a.weight);

    let meanLightness = 0;
    let meanChroma = 0;
    let coloredMass = 0;
    let dominant = null;
    let dominantScore = -1;

    for (const color of palette) {
      meanLightness += color.L * color.weight;
      meanChroma += color.chroma * color.weight;

      if (color.chroma >= CFG.minChromaticChroma) {
        coloredMass += color.weight;

        const score = color.weight * (
          0.35 + 0.65 * Math.min(1, color.chroma / 50)
        );

        if (score > dominantScore) {
          dominantScore = score;
          dominant = color;
        }
      }
    }

    return {
      failed: false,
      neutral:
        coloredMass < CFG.neutralColorMassThreshold ||
        !dominant,
      palette,
      dominantHue: dominant ? dominant.hue : 0,
      dominantChroma: dominant ? dominant.chroma : 0,
      meanLightness,
      meanChroma,
      coloredMass
    };
  }

  function failedDescriptor() {
    return {
      failed: true,
      neutral: true,
      palette: [],
      centerPalette: [],
      edgePalette: [],
      dominantHue: 0,
      dominantChroma: 0,
      meanLightness: 50,
      meanChroma: 0,
      coloredMass: 0
    };
  }

  // ============================================================
  // 6. BILDER ANALYSIEREN
  //
  // Eine kleine Vorschau reicht für die Farbverteilung.
  // Gesamtbild, Bildmitte und Randzonen werden separat betrachtet.
  // Die Bildmitte wird nicht mit dem tatsächlichen Motiv gleichgesetzt;
  // sie erhält lediglich eine zusätzliche, moderate Gewichtung.
  // ============================================================

  function analyzeImageColor(source) {
    return new Promise((resolve) => {
      const image = new Image();

      image.decoding = "async";

      image.onload = () => {
        try {
          const ratio = Math.min(
            CFG.previewWidth / image.naturalWidth,
            CFG.previewMaxHeight / image.naturalHeight
          );

          const width = Math.max(
            1,
            Math.round(image.naturalWidth * ratio)
          );

          const height = Math.max(
            1,
            Math.round(image.naturalHeight * ratio)
          );

          const canvas = document.createElement("canvas");

          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext("2d", {
            willReadFrequently: true
          });

          if (!context) {
            resolve(failedDescriptor());
            return;
          }

          context.drawImage(image, 0, 0, width, height);

          const pixels = context.getImageData(
            0,
            0,
            width,
            height
          ).data;

          const full = [];
          const center = [];
          const edge = [];

          const cx0 = width * 0.20;
          const cx1 = width * 0.80;
          const cy0 = height * 0.16;
          const cy1 = height * 0.84;

          const ex0 = width * 0.16;
          const ex1 = width * 0.84;
          const ey0 = height * 0.13;
          const ey1 = height * 0.87;

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const offset = (y * width + x) * 4;
              const alpha = pixels[offset + 3] / 255;

              if (alpha < 0.08) continue;

              const lab = rgbToLab(
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2]
              );

              const nx = (x + 0.5) / width * 2 - 1;
              const ny = (y + 0.5) / height * 2 - 1;

              const boost = Math.exp(
                -(nx * nx + ny * ny) / 0.82
              );

              full.push({
                ...lab,
                weight: alpha * (0.90 + 0.22 * boost)
              });

              if (
                x >= cx0 && x <= cx1 &&
                y >= cy0 && y <= cy1
              ) {
                center.push({
                  ...lab,
                  weight: alpha
                });
              }

              if (
                x <= ex0 || x >= ex1 ||
                y <= ey0 || y >= ey1
              ) {
                edge.push({
                  ...lab,
                  weight: alpha
                });
              }
            }
          }

          if (!full.length) {
            resolve(failedDescriptor());
            return;
          }

          const mainPalette = buildPalette(
            full,
            `${source}:full`,
            CFG.paletteSize
          );

          const centerPalette = buildPalette(
            center.length ? center : full,
            `${source}:center`,
            CFG.regionalPaletteSize
          );

          const edgePalette = buildPalette(
            edge.length ? edge : full,
            `${source}:edge`,
            CFG.regionalPaletteSize
          );

          resolve({
            ...mainPalette,
            centerPalette: centerPalette.palette,
            edgePalette: edgePalette.palette
          });
        } catch (error) {
          console.warn(
            "Farbpalette konnte nicht analysiert werden:",
            source,
            error
          );

          resolve(failedDescriptor());
        }
      };

      image.onerror = () => {
        console.warn(
          "Bild für Farbanalyse nicht ladbar:",
          source
        );

        resolve(failedDescriptor());
      };

      image.src = source;
    });
  }

  function getColorDescriptor(card) {
    const source = imageCandidates(getNumber(card))[0];

    if (!source) {
      return Promise.resolve(failedDescriptor());
    }

    if (!descriptorCache.has(source)) {
      descriptorCache.set(
        source,
        analyzeImageColor(source)
      );
    }

    return descriptorCache.get(source);
  }

  // ============================================================
  // 7. PALETTENVERGLEICH MIT OPTIMALEM MASSENTRANSPORT
  //
  // Earth Mover's Distance verteilt die gesamte Farbmasse einer
  // Palette optimal auf die Farbmasse der anderen Palette.
  //
  // Dadurch kann eine einzige Farbe nicht beliebig viele andere
  // Farben als ihren ähnlichsten Treffer "bedienen".
  // ============================================================

  function normalizedPalette(input) {
    if (!Array.isArray(input) || !input.length) {
      return [];
    }

    const valid = input.filter((c) =>
      Number.isFinite(c.L) &&
      Number.isFinite(c.a) &&
      Number.isFinite(c.b) &&
      Number.isFinite(c.weight) &&
      c.weight > 0
    );

    const total = valid.reduce(
      (sum, c) => sum + c.weight,
      0
    );

    return total > 0
      ? valid.map((c) => ({
          ...c,
          weight: c.weight / total
        }))
      : [];
  }

  function earthMoversDistance(inputA, inputB) {
    const a = normalizedPalette(inputA);
    const b = normalizedPalette(inputB);

    if (!a.length || !b.length) {
      return 100;
    }

    const n = a.length;
    const m = b.length;

    const source = 0;
    const firstA = 1;
    const firstB = firstA + n;
    const sink = firstB + m;

    const graph = Array.from(
      { length: sink + 1 },
      () => []
    );

    function addEdge(from, to, cap, cost) {
      const forward = {
        to,
        rev: graph[to].length,
        cap,
        cost
      };

      const reverse = {
        to: from,
        rev: graph[from].length,
        cap: 0,
        cost: -cost
      };

      graph[from].push(forward);
      graph[to].push(reverse);
    }

    // Quelle -> Palettenfarben A
    for (let i = 0; i < n; i++) {
      addEdge(
        source,
        firstA + i,
        a[i].weight,
        0
      );
    }

    // Jede A-Farbe kann Masse an jede B-Farbe transportieren.
    // Die Transportkosten basieren auf CIEDE2000.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        addEdge(
          firstA + i,
          firstB + j,
          1,
          deltaE2000(a[i], b[j])
        );
      }
    }

    // Palettenfarben B -> Senke
    for (let j = 0; j < m; j++) {
      addEdge(
        firstB + j,
        sink,
        b[j].weight,
        0
      );
    }

    let flow = 0;
    let totalCost = 0;

    const eps = 1e-8;
    const required = 1;
    const nodes = graph.length;

    // Successive Shortest Augmenting Paths mit Bellman-Ford.
    // Die negativen Rückwärtskanten erlauben eine optimale Korrektur
    // bereits zugewiesener Transportmengen.
    while (flow < required - eps) {
      const dist = new Array(nodes).fill(Infinity);
      const prevNode = new Array(nodes).fill(-1);
      const prevEdge = new Array(nodes).fill(-1);

      dist[source] = 0;

      for (let pass = 0; pass < nodes - 1; pass++) {
        let changed = false;

        for (let u = 0; u < nodes; u++) {
          if (!Number.isFinite(dist[u])) continue;

          for (
            let ei = 0;
            ei < graph[u].length;
            ei++
          ) {
            const e = graph[u][ei];

            if (e.cap <= eps) continue;

            const candidate = dist[u] + e.cost;

            if (candidate + 1e-12 < dist[e.to]) {
              dist[e.to] = candidate;
              prevNode[e.to] = u;
              prevEdge[e.to] = ei;
              changed = true;
            }
          }
        }

        if (!changed) break;
      }

      if (!Number.isFinite(dist[sink])) break;

      let amount = required - flow;

      for (
        let v = sink;
        v !== source;
        v = prevNode[v]
      ) {
        const u = prevNode[v];
        const ei = prevEdge[v];

        if (u < 0 || ei < 0) {
          amount = 0;
          break;
        }

        amount = Math.min(
          amount,
          graph[u][ei].cap
        );
      }

      if (amount <= eps) break;

      for (
        let v = sink;
        v !== source;
        v = prevNode[v]
      ) {
        const u = prevNode[v];
        const ei = prevEdge[v];
        const e = graph[u][ei];

        e.cap -= amount;
        graph[v][e.rev].cap += amount;
      }

      flow += amount;
      totalCost += amount * dist[sink];
    }

    return flow > eps
      ? totalCost / flow
      : 100;
  }

  function paletteDistance(a, b) {
    if (a.failed || b.failed) return 100;

    const full = earthMoversDistance(
      a.palette,
      b.palette
    );

    const center =
      a.centerPalette?.length &&
      b.centerPalette?.length
        ? earthMoversDistance(
            a.centerPalette,
            b.centerPalette
          )
        : full;

    const edge =
      a.edgePalette?.length &&
      b.edgePalette?.length
        ? earthMoversDistance(
            a.edgePalette,
            b.edgePalette
          )
        : full;

    return (
      CFG.fullPaletteWeight * full +
      CFG.centerPaletteWeight * center +
      CFG.edgePaletteWeight * edge
    );
  }

  function cardTransitionDistance(a, b) {
    if (a.originalIndex === b.originalIndex) {
      return 0;
    }

    const first = Math.min(
      a.originalIndex,
      b.originalIndex
    );

    const second = Math.max(
      a.originalIndex,
      b.originalIndex
    );

    const key = `${first}:${second}`;

    if (pairDistanceCache.has(key)) {
      return pairDistanceCache.get(key);
    }

    let distance = paletteDistance(
      a.color,
      b.color
    );

    if (!a.color.failed && !b.color.failed) {
      if (
        a.color.dominantChroma > 12 &&
        b.color.dominantChroma > 12
      ) {
        distance +=
          CFG.hueTransitionWeight *
          circularHueDifference(
            a.color.dominantHue,
            b.color.dominantHue
          );
      }

      distance +=
        CFG.lightnessTransitionWeight *
        Math.abs(
          a.color.meanLightness -
          b.color.meanLightness
        );

      distance +=
        CFG.chromaTransitionWeight *
        Math.abs(
          a.color.meanChroma -
          b.color.meanChroma
        );
    }

    pairDistanceCache.set(key, distance);

    return distance;
  }

  // ============================================================
  // 8. GLOBALER FARBVERLAUF
  //
  // Der Start liegt an der größten Lücke zwischen den vertretenen
  // dominanten Farbtönen. Dadurch wird kein Rot-Anfang erzwungen.
  // ============================================================

  function findHueStart(items) {
    const hues = items
      .filter((item) =>
        !item.color.failed &&
        item.color.dominantChroma >= CFG.minChromaticChroma
      )
      .map((item) => item.color.dominantHue)
      .sort((a, b) => a - b);

    if (hues.length < 2) {
      return hues[0] ?? 0;
    }

    let largestGap = -1;
    let startHue = hues[0];

    for (let i = 0; i < hues.length; i++) {
      const current = hues[i];

      const next = i === hues.length - 1
        ? hues[0] + 360
        : hues[i + 1];

      if (next - current > largestGap) {
        largestGap = next - current;
        startHue = next % 360;
      }
    }

    return startHue;
  }

  function huePosition(hue, startHue) {
    return (hue - startHue + 360) % 360;
  }

  // Die Zielfunktion bewertet die gesamte Pfadqualität.
  // Rückwärtssprünge im Farbverlauf werden bestraft, bleiben aber möglich,
  // wenn dadurch die Palette der Nachbarn wesentlich besser zusammenpasst.
  function routeCost(items) {
    let total = 0;

    for (let i = 1; i < items.length; i++) {
      const previous = items[i - 1];
      const current = items[i];

      total += cardTransitionDistance(
        previous,
        current
      );

      if (
        Number.isFinite(previous.relativeHue) &&
        Number.isFinite(current.relativeHue) &&
        !previous.color.neutral &&
        !current.color.neutral
      ) {
        const backward = Math.max(
          0,
          previous.relativeHue - current.relativeHue
        );

        total += CFG.hueBacktrackPenalty * backward;
      }
    }

    return total;
  }

  function reverseRange(items, start, end) {
    while (start < end) {
      [items[start], items[end]] = [
        items[end],
        items[start]
      ];

      start++;
      end--;
    }
  }

  // ============================================================
  // 9. GLOBALE REIHENFOLGE OPTIMIEREN
  //
  // Ausgangspunkt ist der durchgehende Farbtonverlauf.
  // Danach werden Karten lokal verschoben und Teilstrecken umgedreht.
  // Ein Zug bleibt nur bestehen, wenn die gesamte Zielfunktion sinkt.
  // ============================================================

  function optimizeChromaticRoute(items) {
    if (items.length < 3) {
      return items;
    }

    let currentCost = routeCost(items);
    const n = items.length;

    for (
      let pass = 0;
      pass < CFG.optimizationPasses;
      pass++
    ) {
      let passImproved = false;

      // A. Relocate: einzelne Karten innerhalb eines kleinen Fensters
      // an andere Stellen verschieben und den gesamten Pfad neu bewerten.
      for (let from = 0; from < n; from++) {
        let bestTarget = from;
        let bestCost = currentCost;

        const low = Math.max(
          0,
          from - CFG.relocateWindow
        );

        const high = Math.min(
          n - 1,
          from + CFG.relocateWindow
        );

        const moving = items[from];

        for (let target = low; target <= high; target++) {
          if (target === from) continue;

          items.splice(from, 1);
          items.splice(target, 0, moving);

          const candidate = routeCost(items);

          // Den ursprünglichen Pfad wiederherstellen.
          items.splice(target, 1);
          items.splice(from, 0, moving);

          if (
            candidate + CFG.improvementEpsilon <
            bestCost
          ) {
            bestCost = candidate;
            bestTarget = target;
          }
        }

        if (bestTarget !== from) {
          items.splice(from, 1);
          items.splice(bestTarget, 0, moving);

          currentCost = bestCost;
          passImproved = true;
        }
      }

      // B. 2-opt: kurze Teilabschnitte umdrehen. Anders als ein einfacher
      // Sortiervergleich berücksichtigt diese Prüfung auch die Richtung
      // der Farbfolge im umgedrehten Abschnitt.
      for (let start = 0; start < n - 2; start++) {
        const maxEnd = Math.min(
          n - 1,
          start + CFG.reversalWindow
        );

        for (
          let end = start + 2;
          end <= maxEnd;
          end++
        ) {
          reverseRange(items, start, end);

          const candidate = routeCost(items);

          if (
            candidate + CFG.improvementEpsilon <
            currentCost
          ) {
            currentCost = candidate;
            passImproved = true;
          } else {
            reverseRange(items, start, end);
          }
        }
      }

      if (!passImproved) break;
    }

    return items;
  }

  // Neutrale Karten werden nicht über einen unzuverlässigen Farbwinkel
  // eingeordnet. Ihre wirklichen Paletten und Helligkeiten bestimmen den Weg.
  function optimizeNeutralRoute(items, previousItem) {
    if (items.length < 3) {
      return items;
    }

    const combined = previousItem
      ? [previousItem, ...items]
      : [...items];

    const costOf = () => {
      let cost = 0;

      for (let i = 1; i < combined.length; i++) {
        cost += cardTransitionDistance(
          combined[i - 1],
          combined[i]
        );
      }

      return cost;
    };

    let cost = costOf();

    for (let start = 1; start < combined.length - 2; start++) {
      const endMax = Math.min(
        combined.length - 1,
        start + CFG.reversalWindow
      );

      for (let end = start + 2; end <= endMax; end++) {
        reverseRange(combined, start, end);

        const candidate = costOf();

        if (
          candidate + CFG.improvementEpsilon <
          cost
        ) {
          cost = candidate;
        } else {
          reverseRange(combined, start, end);
        }
      }
    }

    return previousItem
      ? combined.slice(1)
      : combined;
  }

  function orderNeutralCards(items, previousItem) {
    const remaining = [...items];

    // Ohne bunte Karten: helle neutrale Karten zuerst, dunkle zuletzt.
    if (!previousItem) {
      return remaining.sort((a, b) =>
        b.color.meanLightness - a.color.meanLightness ||
        a.originalIndex - b.originalIndex
      );
    }

    // Mit buntem Vorgänger: den weichsten tatsächlichen Palettenübergang
    // zu einer neutralen Karte suchen und danach iterativ weitergehen.
    const ordered = [];
    let previous = previousItem;

    while (remaining.length) {
      let best = 0;
      let bestCost = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cost = cardTransitionDistance(
          previous,
          remaining[i]
        );

        if (cost < bestCost) {
          bestCost = cost;
          best = i;
        }
      }

      previous = remaining.splice(best, 1)[0];
      ordered.push(previous);
    }

    return optimizeNeutralRoute(
      ordered,
      previousItem
    );
  }

  // ============================================================
  // 10. KOMPLETTE FARBSortierung
  // ============================================================

  async function sortByPerceivedColor(cards) {
    const analyzed = new Array(cards.length);

    let nextIndex = 0;
    let completed = 0;

    const workers = Math.min(
      CFG.maxWorkers,
      cards.length
    );

    async function worker() {
      while (nextIndex < cards.length) {
        const index = nextIndex++;
        const card = cards[index];

        analyzed[index] = {
          card,
          color: await getColorDescriptor(card),
          originalIndex: index
        };

        completed++;

        if (sortToggle && colorSortBusy) {
          sortToggle.textContent =
            `Farben analysieren … ${completed}/${cards.length}`;
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: workers },
        () => worker()
      )
    );

    const failures = analyzed.filter(
      (item) => item.color.failed
    );

    const usable = analyzed.filter(
      (item) => !item.color.failed
    );

    const colorful = usable.filter(
      (item) => !item.color.neutral
    );

    const neutral = usable.filter(
      (item) => item.color.neutral
    );

    if (!colorful.length) {
      return [
        ...orderNeutralCards(neutral, null),
        ...failures
      ].map((item) => item.card);
    }

    // Adaptiven Startpunkt ermitteln und die Farbtöne kontinuierlich
    // auf einer linearen Achse über den gewählten Farbkreisbogen abbilden.
    const startHue = findHueStart(colorful);

    for (const item of colorful) {
      item.relativeHue = huePosition(
        item.color.dominantHue,
        startHue
      );
    }

    colorful.sort((a, b) =>
      a.relativeHue - b.relativeHue ||
      b.color.coloredMass - a.color.coloredMass ||
      a.color.meanLightness - b.color.meanLightness ||
      a.originalIndex - b.originalIndex
    );

    // Lokale Ähnlichkeiten verbessern, ohne den übergeordneten Farbfluss
    // einfach zugunsten zufälliger Nachbarschaften zu zerstören.
    const chromaticOrder = optimizeChromaticRoute(colorful);

    const lastColorful =
      chromaticOrder[chromaticOrder.length - 1] || null;

    const neutralOrder = orderNeutralCards(
      neutral,
      lastColorful
    );

    // Nicht analysierbare Bilder kommen ans Ende, aber werden nicht
    // fälschlich als grau oder schwarz klassifiziert.
    return [
      ...chromaticOrder,
      ...neutralOrder,
      ...failures
    ].map((item) => item.card);
  }

  // ============================================================
  // 11. SORTIERBUTTON
  //
  // Zufall -> Dateiname absteigend -> Farbe -> Zufall
  // ============================================================

  if (sortToggle) {
    sortToggle.addEventListener("click", async () => {
      if (!sourceCards.length || colorSortBusy) {
        return;
      }

      // Zufall -> nach Dateiname sortieren
      if (sortMode === "random") {
        renderCards(
          sortByFilenameDescending(sourceCards)
        );

        sortMode = "date";
        updateSortButton();
        return;
      }

      // Dateiname -> Farbsortierung
      if (sortMode === "date") {
        colorSortBusy = true;
        sortToggle.disabled = true;

        sortToggle.setAttribute(
          "aria-busy",
          "true"
        );

        sortToggle.textContent =
          `Farben analysieren … 0/${sourceCards.length}`;

        try {
          const sortedCards =
            await sortByPerceivedColor(sourceCards);

          renderCards(sortedCards);
          sortMode = "color";
        } catch (error) {
          console.error(
            "Farbsortierung fehlgeschlagen:",
            error
          );

          sortMode = "date";
        } finally {
          colorSortBusy = false;
          sortToggle.disabled = false;

          sortToggle.removeAttribute("aria-busy");

          updateSortButton();
        }

        return;
      }

      // Farbe -> neu mischen
      renderCards(
        shuffleArray([...sourceCards])
      );

      sortMode = "random";
      updateSortButton();
    });
  }

  // ============================================================
  // 12. KARTENDATEN LADEN
  // ============================================================

  async function init() {
    if (sortToggle) {
      sortToggle.disabled = true;
    }

    gallery.setAttribute("aria-busy", "true");

    try {
      const response = await fetch(
        "assets/json/karten.json",
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `karten.json konnte nicht geladen werden (HTTP ${response.status}).`
        );
      }

      const cards = await response.json();

      if (!Array.isArray(cards)) {
        throw new Error(
          "karten.json muss ein JSON-Array mit Kartenobjekten enthalten."
        );
      }

      const validCards = cards.filter((card) =>
        card &&
        typeof card === "object" &&
        !Array.isArray(card) &&
        String(card.Nummer ?? "").trim() !== ""
      );

      if (!validCards.length) {
        showMessage(
          "Noch keine Karten vorhanden. Ergänze karten.json um Kartenobjekte mit Nummer, Name und Background-Story."
        );

        return;
      }

      sourceCards = validCards;
      sortMode = "random";

      // Wie bisher: Beim Laden automatisch zufällig mischen.
      renderCards(
        shuffleArray([...sourceCards])
      );

      if (sortToggle) {
        sortToggle.disabled = false;
        updateSortButton();
      }
    } catch (error) {
      console.error("KI Sammelkarten:", error);

      showMessage(
        "Die Karten konnten nicht geladen werden. Prüfe bitte, ob karten.json gültiges JSON enthält und über den Webserver erreichbar ist.",
        true
      );

      if (sortToggle) {
        sortToggle.disabled = true;
      }
    }
  }

  // ============================================================
  // START
  // ============================================================

  init();
})();
