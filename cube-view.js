(() => {
  'use strict';

  const { faces, vectors, colours } = Cube;
  const W = 720;
  const H = 490;
  const positionInView = ([x, y, z]) => [351 + 98 * x - 81 * z, 218 - 95 * y + 40 * x + 43 * z];
  const cameraDepth = ([x, y, z]) => 7695 * x + 7454 * y + 9310 * z;
  const facingCamera = normal => cameraDepth(normal) > 0;
  const cubiesBySize = new Map([2, 3, 4].map(size => {
    const coords = Array.from({ length: size }, (_, index) => (2 * index + 1) / size - 1);
    return [size, coords.flatMap(x => coords.flatMap(y => coords.map(z => [x, y, z])))];
  }));

  function turnPoint([x, y, z], axis, angle) {
    if (axis < 0 || !angle) return [x, y, z];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (axis === 0) return [x, y * c + z * s, z * c - y * s];
    if (axis === 1) return [x * c - z * s, y, z * c + x * s];
    return [x * c + y * s, y * c - x * s, z];
  }

  function traceRoundedQuad(ctx, points, radius = 0.14) {
    ctx.beginPath();
    const len = points.length;
    for (let i = 0; i < len; i++) {
      const prev = points[(i + len - 1) % len];
      const curr = points[i];
      const next = points[(i + 1) % len];
      const ax = curr[0] + (prev[0] - curr[0]) * radius;
      const ay = curr[1] + (prev[1] - curr[1]) * radius;
      const bx = curr[0] + (next[0] - curr[0]) * radius;
      const by = curr[1] + (next[1] - curr[1]) * radius;
      if (i === 0) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
      ctx.quadraticCurveTo(curr[0], curr[1], bx, by);
    }
    ctx.closePath();
  }

  function drawRoundedQuad(ctx, points, radius, fill, stroke, width = 1) {
    traceRoundedQuad(ctx, points, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function paint(ctx, state, { move, size = 2, fraction = 0, intro = 1, completed = false, flags = [] } = {}) {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (ctx.canvas.width !== Math.round(W * dpr) || ctx.canvas.height !== Math.round(H * dpr)) {
      ctx.canvas.width = Math.round(W * dpr);
      ctx.canvas.height = Math.round(H * dpr);
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const turn = typeof move === 'string'
      ? { face: move[0], from: 1, to: 1, turns: move.endsWith('2') ? 2 : move.endsWith("'") ? 3 : 1 }
      : move;
    const turningFace = turn?.face;
    const cubies = cubiesBySize.get(size);
    const axis = turningFace ? vectors[turningFace][0].findIndex(Boolean) : -1;
    const sign = turningFace ? vectors[turningFace][0][axis] : 1;
    const quarterTurns = (turn?.turns === 3 ? -1 : turn?.turns ?? 0) * sign;
    const layer = pos => Math.round((1 - sign * pos[axis]) * size / 2 + .5);
    const rotatingAt = pos => turn && layer(pos) >= turn.from && layer(pos) <= turn.to;
    const activeTurn = fraction > 0 && fraction < 1;
    const angle = fraction * quarterTurns * Math.PI / 2;
    const lift = activeTurn ? Math.sin(fraction * Math.PI) * 0.045 : 0;
    const gap = 0.022;

    // Floor shadow with subtle breathing response during turns
    const shadowScale = 1 + (activeTurn ? Math.sin(fraction * Math.PI) * 0.04 : 0);
    const shadow = ctx.createRadialGradient(350, 384, 8, 350, 384, 190 * shadowScale);
    shadow.addColorStop(0, 'rgba(3, 6, 15, 0.72)');
    shadow.addColorStop(0.55, 'rgba(5, 10, 24, 0.34)');
    shadow.addColorStop(1, 'rgba(5, 10, 24, 0)');
    ctx.save();
    ctx.translate(0, 336);
    ctx.scale(1, 0.37);
    ctx.translate(0, -336);
    ctx.fillStyle = shadow;
    ctx.fillRect(150, 190, 400, 390);
    ctx.restore();

    function transformPoint(point, rotating) {
      if (!rotating) return point;
      const lifted = point.slice();
      if (axis >= 0 && lift) lifted[axis] += lift * sign;
      return turnPoint(lifted, axis, angle);
    }

    function drawCubie(pos, rotating) {
      const visibleFaces = [];
      for (const [fi, face] of faces.entries()) {
        const [normal, right, down] = vectors[face];
        const rotatedNormal = rotating ? turnPoint(normal, axis, angle) : normal;
        if (!facingCamera(rotatedNormal)) continue;
        const isOuter = dot(pos, normal) >= 1 - 1 / size;
        visibleFaces.push({ fi, face, normal, right, down, rotatedNormal, isOuter });
      }
      // Draw inner seam faces before outer sticker faces on the same cubie
      visibleFaces.sort((a, b) => Number(a.isOuter) - Number(b.isOuter));

      for (const { fi, face, normal, right, down, rotatedNormal, isOuter } of visibleFaces) {
        const plane = isOuter ? 1 : dot(pos, normal) + 1 / size - gap;
        const col = Math.round((dot(pos, right) + 1) * size / 2 - .5);
        const row = Math.round((dot(pos, down) + 1) * size / 2 - .5);
        const bounds = index => [-1 + 2 * index / size + (index ? gap : 0),
          -1 + 2 * (index + 1) / size - (index < size - 1 ? gap : 0)];
        const [r0, r1] = bounds(col);
        const [d0, d1] = bounds(row);

        const uv = (u, v) => {
          const x = r0 + u * (r1 - r0);
          const y = d0 + v * (d1 - d0);
          const p3d = [
            normal[0] * plane + right[0] * x + down[0] * y,
            normal[1] * plane + right[1] * x + down[1] * y,
            normal[2] * plane + right[2] * x + down[2] * y,
          ];
          return positionInView(transformPoint(p3d, rotating));
        };

        const bodyQuad = [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)];
        if (!isOuter) {
          drawRoundedQuad(ctx, bodyQuad, 0.08, '#111829', '#1e2942', 1.2);
          continue;
        }

        // 3D directional lighting on the plastic cubie body (leaving sticker hues pure)
        const light = Math.max(0, Math.min(1, rotatedNormal[0] * 0.25 + rotatedNormal[1] * 0.65 + rotatedNormal[2] * 0.4 + 0.35));
        const bodyFill = light > 0.75 ? '#1e2942' : light > 0.45 ? '#161f33' : '#101726';
        const isTurnLayer = rotating && axis >= 0;
        const bodyStroke = isTurnLayer
          ? (completed ? 'rgba(202, 255, 115, 0.45)' : 'rgba(202, 255, 115, 0.72)')
          : '#33415f';
        drawRoundedQuad(ctx, bodyQuad, 0.11, bodyFill, bodyStroke, isTurnLayer ? 2 : 1.4);

        const index = fi * size * size + row * size + col;
        const pad = 0.082;
        const stickerQuad = [uv(pad, pad), uv(1 - pad, pad), uv(1 - pad, 1 - pad), uv(pad, 1 - pad)];
        const colourCode = state[index];
        const baseHex = colourCode ? colours[colourCode][1] : '#2c3a57';

        // Pure bright sticker fill with dark bevel outline
        drawRoundedQuad(ctx, stickerQuad, 0.15, baseHex, '#0a0f1d', 1.8);

        // Subtle neutral specular sheen that preserves 100% of yellow/orange hue separation
        if (colourCode) {
          const [x0, y0] = stickerQuad[0];
          const [x2, y2] = stickerQuad[2];
          const grad = ctx.createLinearGradient(x0, y0, x2, y2);
          const topGlow = light > 0.7 ? 0.16 : 0.09;
          const bottomShade = light < 0.35 ? 0.07 : 0.03;
          grad.addColorStop(0, `rgba(255, 255, 255, ${topGlow})`);
          grad.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
          grad.addColorStop(1, `rgba(0, 0, 0, ${bottomShade})`);
          drawRoundedQuad(ctx, stickerQuad, 0.15, grad, 'rgba(255, 255, 255, 0.28)', 0.9);
        } else {
          drawRoundedQuad(ctx, stickerQuad, 0.15, null, 'rgba(255, 255, 255, 0.16)', 1);
        }

        // High-contrast double ring for flagged stickers (visible on yellow, orange, and white)
        if (flags.includes(index)) {
          const outerWidth = size === 2 ? 6.5 : size === 3 ? 5.2 : 4.2;
          const innerWidth = size === 2 ? 3.5 : size === 3 ? 2.7 : 2.2;
          const dotRadius = size === 2 ? 6 : size === 3 ? 5 : 4;
          const dotStroke = size === 2 ? 2.2 : size === 3 ? 1.8 : 1.6;
          drawRoundedQuad(ctx, stickerQuad, 0.15, null, '#090d16', outerWidth);
          drawRoundedQuad(ctx, stickerQuad, 0.15, null, '#ff389c', innerWidth);
          const [cx, cy] = uv(0.5, 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#090d16';
          ctx.fill();
          ctx.lineWidth = dotStroke;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }
      }
    }

    const visible = cubies
      .map(pos => {
        const rotating = rotatingAt(pos);
        return { pos, rotating, depth: cameraDepth(transformPoint(pos, rotating)) };
      })
      .sort((a, b) => a.depth - b.depth);
    for (const { pos, rotating } of visible) drawCubie(pos, rotating);

    function drawMoveBadge(cx, cy, text, alpha = 1) {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.font = '800 15px Geist, "DM Sans", sans-serif';
      const minDiameter = 40 * (0.9 + 0.1 * intro);
      const width = Math.max(minDiameter, ctx.measureText(text).width + 18);
      const height = minDiameter;
      const radius = height / 2;
      ctx.beginPath();
      ctx.roundRect(cx - width / 2, cy - height / 2, width, height, radius);
      ctx.fillStyle = 'rgba(15, 22, 34, 0.94)';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#caff73';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#caff73';
      ctx.fillText(text, cx, cy + 1);
      ctx.restore();
    }

    // Draw 3D perspective turn highlight, directional arrows & move badge
    if (turningFace) {
      const [normal, right, down] = vectors[turningFace];
      const rotatedNormal = turnPoint(normal, axis, angle);
      const hasVisibleOuterCap = turn.from === 1 && facingCamera(rotatedNormal);
      const moveLabel = typeof move === 'string' ? move : move.notation;
      const a0 = sign * (1 - 2 * (turn.from - 1) / size);
      const a1 = sign * (1 - 2 * turn.to / size);
      const aMid = (a0 + a1) / 2;
      const dir = quarterTurns < 0 ? -1 : 1;

      const slicePoint = (sideNormal, tangent, alongAxis, alongTangent, extraLift = 0.014) => {
        const p3d = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          p3d[c] = sideNormal[c] * (1 + extraLift) + tangent[c] * alongTangent;
        }
        p3d[axis] = alongAxis;
        return positionInView(transformPoint(p3d, true));
      };

      // Highlight the turning layer band on visible side faces (for wide, inner-slice, and back-facing turns)
      const showSliceSides = !hasVisibleOuterCap || turn.to > turn.from;
      if (showSliceSides) {
        const sideFaces = faces.filter(face => {
          const n = vectors[face][0];
          return n[axis] === 0;
        });
        for (const sideFace of sideFaces) {
          const sideNormal = vectors[sideFace][0];
          const rotatedSide = turnPoint(sideNormal, axis, angle);
          const sideDepth = cameraDepth(rotatedSide);
          if (sideDepth <= 0) continue;
          const fade = Math.min(1, sideDepth / 1800);
          const tangent = turnPoint(sideNormal, axis, dir * Math.PI / 2);
          const band = [
            slicePoint(sideNormal, tangent, a0, -1),
            slicePoint(sideNormal, tangent, a0, 1),
            slicePoint(sideNormal, tangent, a1, 1),
            slicePoint(sideNormal, tangent, a1, -1),
          ];
          const baseAlpha = (completed ? 0.55 : 0.88) * fade;
          drawRoundedQuad(ctx, band, 0.04, null, `rgba(202, 255, 115, ${baseAlpha})`, completed ? 2.4 : 3.2);

          if (!hasVisibleOuterCap) {
            const span = 0.48 * Math.max(0.3, intro);
            const tStart = -span;
            const tEnd = span;
            const tip = slicePoint(sideNormal, tangent, aMid, tEnd, 0.032);
            const tail = slicePoint(sideNormal, tangent, aMid, tStart, 0.032);
            const wingHalf = Math.min(0.15, Math.abs(a0 - a1) * 0.32);
            const wingBack = tEnd - 0.2;
            const wingA = slicePoint(sideNormal, tangent, aMid + wingHalf, wingBack, 0.032);
            const wingB = slicePoint(sideNormal, tangent, aMid - wingHalf, wingBack, 0.032);

            ctx.save();
            ctx.globalAlpha = (completed ? 0.82 : 0.96) * fade;
            for (const [stroke, width] of [['rgba(11, 16, 29, 0.9)', 9], ['#caff73', 4.2]]) {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = width;
              ctx.beginPath();
              ctx.moveTo(tail[0], tail[1]);
              ctx.lineTo(tip[0], tip[1]);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(wingA[0], wingA[1]);
              ctx.lineTo(tip[0], tip[1]);
              ctx.lineTo(wingB[0], wingB[1]);
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        if (!hasVisibleOuterCap) {
          const badge3d = [1.12, 1.12, 1.12];
          badge3d[axis] = aMid + lift * sign;
          const [bx, by] = positionInView(badge3d);
          drawMoveBadge(bx, by, moveLabel, completed ? 0.9 : 1);
        }
      }

      if (hasVisibleOuterCap) {
        const facePoint = (x, y, extraLift = 0.012) => {
          const p3d = [
            normal[0] * (1 + extraLift) + right[0] * x + down[0] * y,
            normal[1] * (1 + extraLift) + right[1] * x + down[1] * y,
            normal[2] * (1 + extraLift) + right[2] * x + down[2] * y,
          ];
          return positionInView(transformPoint(p3d, true));
        };

        // Outer glowing frame around the turning face
        const borderQuad = [facePoint(-1, -1), facePoint(1, -1), facePoint(1, 1), facePoint(-1, 1)];
        const borderAlpha = completed ? 0.65 : 0.94;
        drawRoundedQuad(ctx, borderQuad, 0.06, null, `rgba(202, 255, 115, ${borderAlpha})`, completed ? 3 : 4.2);

        // 3D curved arrow lying in the plane of the turning face
        const sweep = (quarterTurns === 2 ? 1.38 : 1.08) * Math.PI * Math.max(0.25, intro);
        const startTheta = dir > 0 ? -Math.PI * 0.72 : -Math.PI * 0.28;
        const endTheta = startTheta + dir * sweep;
        const radius = 0.54;
        const steps = 28;
        const arcPoints = [];
        for (let s = 0; s <= steps; s++) {
          const t = startTheta + (endTheta - startTheta) * (s / steps);
          arcPoints.push(facePoint(Math.cos(t) * radius, Math.sin(t) * radius, 0.03));
        }

        // Arrow head geometry in the 3D face plane at endTheta
        const tip = facePoint(Math.cos(endTheta) * radius, Math.sin(endTheta) * radius, 0.03);
        const backTheta = endTheta - dir * 0.26;
        const wingOuter = facePoint(Math.cos(backTheta) * (radius + 0.14), Math.sin(backTheta) * (radius + 0.14), 0.03);
        const wingInner = facePoint(Math.cos(backTheta) * (radius - 0.14), Math.sin(backTheta) * (radius - 0.14), 0.03);

        ctx.save();
        if (completed) ctx.globalAlpha = 0.86;

        // Dark halo under-stroke for high contrast over bright yellow/white stickers
        ctx.beginPath();
        arcPoints.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = 'rgba(11, 16, 29, 0.88)';
        ctx.lineWidth = 9.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wingOuter[0], wingOuter[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.lineTo(wingInner[0], wingInner[1]);
        ctx.strokeStyle = 'rgba(11, 16, 29, 0.88)';
        ctx.lineWidth = 9.5;
        ctx.stroke();

        // Bright lime foreground stroke for the 3D arrow
        ctx.beginPath();
        arcPoints.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = '#caff73';
        ctx.lineWidth = 4.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(wingOuter[0], wingOuter[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.lineTo(wingInner[0], wingInner[1]);
        ctx.strokeStyle = '#caff73';
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.restore();

        // Center move badge on the turning face
        const [cx, cy] = facePoint(0, 0, 0.04);
        drawMoveBadge(cx, cy, moveLabel, completed ? 0.92 : 1);
      }
    }

    ctx.restore();
  }

  globalThis.paintCube = paint;
})();
