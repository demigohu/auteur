// What scene code may import. Anything else fails at load time (and earlier, in validate.mjs).
import * as Noise from "@remotion/noise";
import * as Paths from "@remotion/paths";
import * as Shapes from "@remotion/shapes";
import * as Transitions from "@remotion/transitions";
import * as ClockWipe from "@remotion/transitions/clock-wipe";
import * as Fade from "@remotion/transitions/fade";
import * as Flip from "@remotion/transitions/flip";
import * as Iris from "@remotion/transitions/iris";
import * as Slide from "@remotion/transitions/slide";
import * as Wipe from "@remotion/transitions/wipe";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as Remotion from "remotion";
import * as Kit from "./kit";

export const MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JsxRuntime,
  remotion: Remotion,
  "@remotion/noise": Noise,
  "@remotion/paths": Paths,
  "@remotion/shapes": Shapes,
  "@remotion/transitions": Transitions,
  "@remotion/transitions/clock-wipe": ClockWipe,
  "@remotion/transitions/fade": Fade,
  "@remotion/transitions/flip": Flip,
  "@remotion/transitions/iris": Iris,
  "@remotion/transitions/slide": Slide,
  "@remotion/transitions/wipe": Wipe,
  "@auteur/kit": { fonts: Kit.fonts },
};
