import { setState } from '../storage.js';
import { stageOne } from './1.js';

export const finalStage = {
  exec(params) {
    const { from, state } = params;
    
    // Reset state to 1
    state.stage = 1;
    state.itens = [];
    state.pendingItem = null;
    setState(from, state);

    // Instantly process the message as a stage 1 request
    return stageOne.exec(params);
  },
};
