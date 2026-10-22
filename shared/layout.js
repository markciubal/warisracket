// Where the parts of a peace-time shop go, worked out from its middle (u, facing f) in world
// units at today's planet size. The planet grows while the town stands, so the server and every
// client work these out again whenever it does, and a shop keeps its size instead of stretching.
import { SHOPS } from './constants.js';
import * as M from './math.js';

// The range: a firing line (at) 3 beside the booth, the middle of the lane in front of it, and a
// row of targets downrange. Everything else is used from where it stands (at: its middle).
export function shopLayout(kind, u, f) {
  if (kind !== 'range') return { at: u, lane: u, targets: [] };
  const def = SHOPS.range;
  const [at, af] = M.moveOnSphere(u, f, M.norm(M.cross(u, f)), 3);
  const lane = M.moveOnSphere(at, af, af, def.downrange / 2)[0];
  const [end, ef] = M.moveOnSphere(at, af, af, def.downrange);
  const side = M.norm(M.cross(end, ef));
  const targets = [];
  for (let i = 0; i < def.targets; i++) targets.push(M.moveOnSphere(end, ef, side, (i - (def.targets - 1) / 2) * def.spread)[0]);
  return { at, lane, targets };
}
