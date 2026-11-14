(() => {
  'use strict';

  const { faces, vectors, stickers, colours } = Cube;
  const positionInView = ([x, y, z]) => [351 + 98 * x - 81 * z, 218 - 95 * y + 40 * x + 43 * z];
  const facingCamera = ([x, y, z]) => 7695 * x + 7454 * y + 9310 * z > 0;

  function turnPoint([x, y, z], axis, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (axis === 0) return [x, y * c + z * s, z * c - y * s];
    if (axis === 1) return [x * c - z * s, y, z * c + x * s];
    return [x * c + y * s, y * c - x * s, z];
  }

  function polygon(ctx, points, fill, stroke, width = 1) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  function paint(ctx, state, { move, fraction = 0, flags = [] } = {}) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const shadow = ctx.createRadialGradient(350, 380, 5, 350, 380, 184);
    shadow.addColorStop(0, '#0009');
    shadow.addColorStop(1, '#0000');
    ctx.save();
    ctx.translate(0, 330);
    ctx.scale(1, .37);
    ctx.translate(0, -330);
    ctx.fillStyle = shadow;
    ctx.fillRect(165, 196, 370, 370);
    ctx.restore();
    ctx.lineJoin = 'round';

    const turningFace = move?.[0];
    // The solver keeps the bottom-back-left corner fixed and uses U, R and F.
    const axis = turningFace ? vectors[turningFace][0].findIndex(Boolean) : -1;
    const quarterTurns = move?.endsWith('2') ? 2 : move?.endsWith("'") ? -1 : 1;
    const cutOpen = fraction > 0 && fraction < 1;
    const angle = fraction * quarterTurns * Math.PI / 2;

    function drawLayer(rotating) {
      const rotate = point => rotating ? turnPoint(point, axis, angle) : point;
      // The turn plane separates the two layers. The positive-axis layer is nearer the camera.
      for (const [fi, face] of faces.entries()) {
        const [normal, right, down] = vectors[face];
        const side = normal[axis];
        const inner = axis >= 0 && (rotating ? side < 0 : side > 0);
        if ((inner && !cutOpen) || !facingCamera(rotate(normal))) continue;
        const h = right[axis];
        const v = down[axis];
        const positive = rotating ? 1 : -1;
        const range = sign => {
          if (!sign) return [-1, 1];
          return sign === positive ? [0, 1] : [-1, 0];
        };
        const [left, rightEdge] = range(h);
        const [top, bottom] = range(v);
        const point = (x, y) => positionInView(rotate(normal.map((n, a) =>
          (inner ? 0 : n) + right[a] * x + down[a] * y)));
        const quad = (x1, y1, x2, y2) => [point(x1, y1), point(x2, y1), point(x2, y2), point(x1, y2)];
        const highlight = rotating && face === turningFace;
        const outline = highlight ? '#caff73' : inner ? '#252f47' : '#66789e';
        const layerBody = inner ? '#1a2235' : '#101829';
        polygon(ctx, quad(left, top, rightEdge, bottom), layerBody, outline, highlight ? 5 : 2);
        if (inner) continue;

        const brightness = Math.max(0, Math.min(1, (rotate(normal)[1] + 1) / 2));
        const shade = 'rgba(6, 13, 38, ' + ((1 - brightness) * .29) + ')';
        for (let i = 0; i < 4; i++) {
          const index = fi * 4 + i;
          if (axis >= 0 && stickers[index].position[axis] !== positive) continue;
          const x = i % 2 - 1;
          const y = Math.floor(i / 2) - 1;
          const shape = quad(x + .065, y + .065, x + .935, y + .935);
          const colour = state[index];
          polygon(ctx, shape, colour ? colours[colour][1] : '#344368', '#ffffff45', 1.2);
          polygon(ctx, shape, shade, flags.includes(index) ? '#ffd082' : undefined, 5);
        }
        if (highlight && fraction === 0) {
          const [x, y] = point(0, 0);
          ctx.beginPath();
          ctx.arc(x, y, 22, 0, Math.PI * 2);
          ctx.fillStyle = '#17230c';
          ctx.fill();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 25px sans-serif';
          ctx.fillStyle = '#caff73';
          ctx.fillText(quarterTurns === 2 ? '180°' : quarterTurns < 0 ? '↺' : '↻', x, y);
        }
      }
    }
    drawLayer(false);
    if (axis >= 0) drawLayer(true);
  }

  globalThis.paintCube = paint;
})();
