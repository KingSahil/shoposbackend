import { setState } from '../storage.js';

export const initialStage = {
  exec({ from, state }) {
    state.stage = 1;
    setState(from, state);

    return '👋 Hello how are you? \n\nI am kiranabot, the *virtual assistant* of KiranaKeeper. \n* can i help you?* 🙋‍♂️';
  },
};
