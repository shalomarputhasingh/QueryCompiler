import { Composition, Folder } from "remotion";
import { QueryCompilerExplainer, SCENES, TOTAL } from "./QueryCompilerExplainer";
import { Algebra } from "./scenes/Algebra";
import { Finale } from "./scenes/Finale";
import { Intro } from "./scenes/Intro";
import { Lexer } from "./scenes/Lexer";
import { Optimizer } from "./scenes/Optimizer";
import { Parser } from "./scenes/Parser";
import { Semantic } from "./scenes/Semantic";

const common = { width: 1920, height: 1080, fps: 30 } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="QueryCompilerExplainer" component={QueryCompilerExplainer} durationInFrames={TOTAL} {...common} />
    <Folder name="Scenes">
      <Composition id="Intro" component={Intro} durationInFrames={SCENES.intro} {...common} />
      <Composition id="Lexer" component={Lexer} durationInFrames={SCENES.lexer} {...common} />
      <Composition id="Parser" component={Parser} durationInFrames={SCENES.parser} {...common} />
      <Composition id="Semantic" component={Semantic} durationInFrames={SCENES.semantic} {...common} />
      <Composition id="Algebra" component={Algebra} durationInFrames={SCENES.algebra} {...common} />
      <Composition id="Optimizer" component={Optimizer} durationInFrames={SCENES.optimizer} {...common} />
      <Composition id="Finale" component={Finale} durationInFrames={SCENES.finale} {...common} />
    </Folder>
  </>
);
