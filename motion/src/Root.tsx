import { Composition } from "remotion";
import { SceneHost, type SceneProps } from "./SceneHost";

const defaults: SceneProps = { js: "", width: 1920, height: 1080, fps: 30, durationInFrames: 150, images: {} };

export const Root = () => (
  <Composition
    id="Scene"
    component={SceneHost}
    defaultProps={defaults}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={150}
    calculateMetadata={({ props }) => ({
      width: props.width,
      height: props.height,
      fps: props.fps,
      durationInFrames: props.durationInFrames,
    })}
  />
);
