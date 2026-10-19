import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Algebra } from "./scenes/Algebra";
import { Finale } from "./scenes/Finale";
import { Intro } from "./scenes/Intro";
import { Lexer } from "./scenes/Lexer";
import { Optimizer } from "./scenes/Optimizer";
import { Parser } from "./scenes/Parser";
import { Semantic } from "./scenes/Semantic";

export const TRANSITION = 15;
export const SCENES = { intro: 105, lexer: 120, parser: 135, semantic: 125, algebra: 125, optimizer: 165, finale: 160 };
export const TOTAL = Object.values(SCENES).reduce((a, b) => a + b, 0) - 6 * TRANSITION;

export const QueryCompilerExplainer: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={SCENES.intro}>
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Lexer" durationInFrames={SCENES.lexer}>
      <Lexer />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Parser" durationInFrames={SCENES.parser}>
      <Parser />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Semantic" durationInFrames={SCENES.semantic}>
      <Semantic />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Algebra" durationInFrames={SCENES.algebra}>
      <Algebra />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Optimizer" durationInFrames={SCENES.optimizer}>
      <Optimizer />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Finale" durationInFrames={SCENES.finale}>
      <Finale />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
