// Everything lives in an IIFE so this file keeps its names to itself rather
// than hanging generic ones like `canvas` and `c` off the global object.
(function () {
  // Initialize canvas and context
  const canvas = document.createElement("canvas");
  canvas.width = 600; // Set canvas width
  canvas.height = 600; // Set canvas height
  const container = document.getElementById("mondrian") || document.body;
  container.appendChild(canvas); // Append canvas to its container
  const c = canvas.getContext("2d"); // Get 2D drawing context

  const LINE_WIDTH = 10;

  // Draw a list of blocks plus the lines between them. Passing the lines in
  // explicitly is what went wrong before: they have to sit exactly on a block
  // edge, otherwise a line cuts straight through the middle of a block.
  function draw(rectangles, lines) {
    // Background color
    c.fillStyle = 'white';
    c.fillRect(0, 0, canvas.width, canvas.height);

    rectangles.forEach(rect => {
      c.fillStyle = rect.color;
      c.fillRect(rect.x, rect.y, rect.width, rect.height);
    });

    c.strokeStyle = 'black';
    c.lineWidth = LINE_WIDTH;

    // Draw the border, inset by half the line width so it is not clipped
    c.strokeRect(
      LINE_WIDTH / 2,
      LINE_WIDTH / 2,
      canvas.width - LINE_WIDTH,
      canvas.height - LINE_WIDTH
    );

    // Draw the separators, each one spanning only the edge it belongs to
    c.beginPath();
    lines.forEach(line => {
      c.moveTo(line.x1, line.y1);
      c.lineTo(line.x2, line.y2);
    });
    c.stroke();
  }

  // Function to draw a Mondrian-style image
  function drawMondrian() {
    // These blocks together tile the full 600x600 canvas
    const rectangles = [
      { x: 0, y: 0, width: 200, height: 200, color: 'red' },
      { x: 200, y: 0, width: 400, height: 100, color: 'blue' },
      { x: 200, y: 100, width: 400, height: 100, color: 'white' },
      { x: 0, y: 200, width: 150, height: 400, color: 'yellow' },
      { x: 150, y: 200, width: 450, height: 200, color: 'black' },
      { x: 150, y: 400, width: 300, height: 200, color: 'red' },
      { x: 450, y: 400, width: 150, height: 200, color: 'blue' },
    ];

    const lines = [
      { x1: 200, y1: 0, x2: 200, y2: 200 },   // red | blue, red | white
      { x1: 200, y1: 100, x2: 600, y2: 100 }, // blue | white
      { x1: 0, y1: 200, x2: 600, y2: 200 },   // top row | middle row
      { x1: 150, y1: 200, x2: 150, y2: 600 }, // yellow | black, yellow | red
      { x1: 150, y1: 400, x2: 600, y2: 400 }, // black | red, black | blue
      { x1: 450, y1: 400, x2: 450, y2: 600 }, // red | blue
    ];

    draw(rectangles, lines);
  }

  // Split a block in two, over and over, until the pieces are small enough.
  // Every split becomes a line, so the lines can never miss a block edge.
  function splitBlock(block, depth, rectangles, lines) {
    const minSize = 90;
    const canSplitHorizontally = block.height >= minSize * 2;
    const canSplitVertically = block.width >= minSize * 2;

    // Stop splitting once we are deep enough, or the block is too small.
    if (depth === 0 || (!canSplitHorizontally && !canSplitVertically)) {
      rectangles.push({ ...block, color: pickColor() });
      return;
    }

    // Prefer cutting across the longer side so we do not get thin slivers.
    let splitVertically;
    if (canSplitVertically && canSplitHorizontally) {
      splitVertically = block.width === block.height
        ? Math.random() < 0.5
        : block.width > block.height;
    } else {
      splitVertically = canSplitVertically;
    }

    // Keep the cut away from the edges, and snap it to a whole pixel so the
    // line and the two blocks line up exactly.
    const size = splitVertically ? block.width : block.height;
    const offset = Math.round(size * (0.3 + Math.random() * 0.4));

    if (splitVertically) {
      const splitX = block.x + offset;
      lines.push({ x1: splitX, y1: block.y, x2: splitX, y2: block.y + block.height });
      splitBlock({ x: block.x, y: block.y, width: offset, height: block.height }, depth - 1, rectangles, lines);
      splitBlock({ x: splitX, y: block.y, width: block.width - offset, height: block.height }, depth - 1, rectangles, lines);
    } else {
      const splitY = block.y + offset;
      lines.push({ x1: block.x, y1: splitY, x2: block.x + block.width, y2: splitY });
      splitBlock({ x: block.x, y: block.y, width: block.width, height: offset }, depth - 1, rectangles, lines);
      splitBlock({ x: block.x, y: splitY, width: block.width, height: block.height - offset }, depth - 1, rectangles, lines);
    }
  }

  // Mondrian left most blocks white and used the primaries as accents.
  function pickColor() {
    const roll = Math.random();
    if (roll < 0.55) return 'white';
    if (roll < 0.7) return 'red';
    if (roll < 0.85) return 'blue';
    if (roll < 0.95) return 'yellow';
    return 'black';
  }

  function generateMondrian() {
    const rectangles = [];
    const lines = [];
    const wholeCanvas = { x: 0, y: 0, width: canvas.width, height: canvas.height };
    splitBlock(wholeCanvas, 4, rectangles, lines);
    draw(rectangles, lines);
  }

  // Call the function to draw the Mondrian image
  drawMondrian();

  // Wire up the button so it actually produces a new composition
  const generateButton = document.getElementById("generate-button");
  if (generateButton) {
    generateButton.addEventListener("click", generateMondrian);
  }
})();
