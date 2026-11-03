import { describe, expect, it } from "vitest";
import { effectiveKeys, poseIn } from "./animate";
import type { Clip } from "./timeline";

// Poses printed by api/src/auteur/animate.py (effective_keys + pose_in) for the same clips.
const CASES: Record<string, { clip: Partial<Clip>; poses: [number, number[]][] }> = {
 "zoom_in+slide_left_out": {
  "clip": {
   "src_in": 0.0,
   "src_out": 3.0,
   "speed": 1.0,
   "transform": {
    "x": 0.1,
    "y": 0.0,
    "scale": 0.8,
    "rotation": 0.0,
    "opacity": 1.0,
    "flip_h": false,
    "flip_v": false
   },
   "transform_keys": [],
   "anim_in": {
    "kind": "zoom_in",
    "duration": 0.6
   },
   "anim_out": {
    "kind": "slide_left",
    "duration": 0.5
   }
  },
  "poses": [
   [
    0,
    [
     0.1,
     0.0,
     0.48,
     0.0,
     0.0
    ]
   ],
   [
    0.13,
    [
     0.1,
     0.0,
     0.64383,
     0.0,
     0.51198
    ]
   ],
   [
    0.3,
    [
     0.1,
     0.0,
     0.76,
     0.0,
     0.875
    ]
   ],
   [
    0.55,
    [
     0.1,
     0.0,
     0.79958,
     0.0,
     0.9987
    ]
   ],
   [
    1.0,
    [
     0.1,
     0.0,
     0.8,
     0.0,
     1.0
    ]
   ],
   [
    1.7,
    [
     0.1,
     0.0,
     0.8,
     0.0,
     1.0
    ]
   ],
   [
    2.4,
    [
     0.1,
     0.0,
     0.8,
     0.0,
     1.0
    ]
   ],
   [
    2.9,
    [
     -0.42109,
     0.0,
     0.8,
     0.0,
     1.0
    ]
   ]
  ]
 },
 "keys+spin_in": {
  "clip": {
   "src_in": 0.0,
   "src_out": 2.0,
   "speed": 1.0,
   "transform": null,
   "transform_keys": [
    {
     "t": 0.5,
     "x": 0.2,
     "y": 0.0,
     "scale": 1.2,
     "rotation": 0.0,
     "opacity": 1.0
    },
    {
     "t": 1.5,
     "x": -0.2,
     "y": 0.0,
     "scale": 1.0,
     "rotation": 30.0,
     "opacity": 0.5
    }
   ],
   "anim_in": {
    "kind": "spin",
    "duration": 1.5
   },
   "anim_out": null
  },
  "poses": [
   [
    0,
    [
     0.2,
     0.0,
     0.36,
     -180.0,
     0.0
    ]
   ],
   [
    0.13,
    [
     0.2,
     0.0,
     0.6456,
     -118.8,
     0.34
    ]
   ],
   [
    0.3,
    [
     0.2,
     0.0,
     0.90534,
     -63.14062,
     0.64922
    ]
   ],
   [
    0.55,
    [
     0.18,
     0.0,
     1.10965,
     -15.79687,
     0.88022
    ]
   ],
   [
    1.0,
    [
     0.0,
     0.0,
     1.1,
     15.0,
     0.75
    ]
   ],
   [
    1.7,
    [
     -0.2,
     0,
     1,
     30.0,
     0.5
    ]
   ],
   [
    2.4,
    [
     -0.2,
     0,
     1,
     30.0,
     0.5
    ]
   ],
   [
    2.9,
    [
     -0.2,
     0,
     1,
     30.0,
     0.5
    ]
   ]
  ]
 },
 "short_clip_fade": {
  "clip": {
   "src_in": 0.0,
   "src_out": 0.6,
   "speed": 1.0,
   "transform": null,
   "transform_keys": [],
   "anim_in": {
    "kind": "fade",
    "duration": 1.0
   },
   "anim_out": {
    "kind": "zoom_out",
    "duration": 1.0
   }
  },
  "poses": [
   [
    0,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     0.0
    ]
   ],
   [
    0.13,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     0.81146
    ]
   ],
   [
    0.3,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    0.55,
    [
     0.0,
     0.0,
     0.7651,
     0.0,
     0.41276
    ]
   ],
   [
    1.0,
    [
     0.0,
     0.0,
     0.6,
     0.0,
     0.0
    ]
   ],
   [
    1.7,
    [
     0.0,
     0.0,
     0.6,
     0.0,
     0.0
    ]
   ],
   [
    2.4,
    [
     0.0,
     0.0,
     0.6,
     0.0,
     0.0
    ]
   ],
   [
    2.9,
    [
     0.0,
     0.0,
     0.6,
     0.0,
     0.0
    ]
   ]
  ]
 },
 "slow_motion_slide_up": {
  "clip": {
   "src_in": 1.0,
   "src_out": 2.0,
   "speed": 0.5,
   "transform": null,
   "transform_keys": [],
   "anim_in": {
    "kind": "slide_up",
    "duration": 0.8
   },
   "anim_out": null
  },
  "poses": [
   [
    0,
    [
     0.0,
     1.0,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    0.13,
    [
     0.0,
     0.59551,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    0.3,
    [
     0.0,
     0.24414,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    0.55,
    [
     0.0,
     0.03418,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    1.0,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    1.7,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    2.4,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     1.0
    ]
   ],
   [
    2.9,
    [
     0.0,
     0.0,
     1.0,
     0.0,
     1.0
    ]
   ]
  ]
 }
};

describe("animate", () => {
  for (const [name, { clip, poses }] of Object.entries(CASES)) {
    it(`matches the export for ${name}`, () => {
      const keys = effectiveKeys(clip as Clip);
      for (const [t, expected] of poses) {
        const p = poseIn(keys, t);
        [p.x, p.y, p.scale, p.rotation, p.opacity].forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
      }
    });
  }
});
