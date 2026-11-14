# Cube Solver

A static 2×2, 3×3 and 4×4 Rubik's Cube solver with animated turns and diagnostics for impossible layouts.

## Test locally

Serve the repository over HTTP, for example with `python -m http.server 8000`, and open `http://localhost:8000`. Select a cube size in the header, then choose **Try an example** and **Replay turn**. Select **Try a twisted-corner example** to check the diagnostics. The 3×3 and 4×4 solvers share a web worker and prepares its search tables on the first nontrivial solve.

## Work in Codex and Antigravity

Clone this repository and open its folder in Antigravity. In Codex, select the same GitHub repository or open the local checkout. Use separate branches and checkouts if both tools are editing at the same time. Review the changes in a pull request before merging.

## Deployment

GitHub Pages serves the static files without a build step.

## 3×3 and 4×4 engine

`solver4-worker.js` uses the MIT-licensed [MrDenzzz/cube-solver](https://github.com/MrDenzzz/cube-solver) at commit `950fa93285640b2e64431a74186513f31d43b613`. See `LICENSE-solver4.txt`.

To rebuild, check out that commit in a sibling folder called `upstream`. With esbuild 0.27.3, rename the local identifier `out` to `output` in `packages/solver-ts/src/four/edge-pairing.ts` to avoid a TypeScript parser ambiguity. Run this command from this repository:

```sh
esbuild solver4-worker.ts --bundle --platform=browser --target=es2022 --minify --alias:@cube/core=../upstream/packages/cube-core/src/index.ts --alias:@cube/solver-contracts=../upstream/packages/solver-contracts/src/index.ts --outfile=solver4-worker.js
```
