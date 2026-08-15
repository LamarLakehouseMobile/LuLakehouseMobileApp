export type RecordedSample = {
  id: string;
  uri: string;
  createdAt: string;
};

export type HomeStackParamList = {
  Home: undefined;
  Profile: undefined;
  TeachableMachine: undefined;
  ProjectType: undefined;
  AudioTraining: undefined;
  ImageTraining: undefined;
  ViewSamples: {
    className: string;
    samples: RecordedSample[];
  };
  ViewImages: {
    className: string;
    samples: RecordedSample[];
  };
  LiveCamera: undefined;
  LiveAudio: undefined;
};
