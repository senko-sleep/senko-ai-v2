// Which replies are worth the extra seconds of model thinking.
// Thinking costs ~4-8s on Gemini; greetings and banter gain nothing from it, while analysis,
// comparisons, planning, maths and code do (and those are where the "Thought for Ns"
// dropdown has something to show).

const DEEP_WORDS = /\b(?:why|how\s+(?:does|do|did|can|could|would|should|to)|explain|compare|comparison|difference|vs\.?|versus|analy[sz]e|analysis|break\s*down|pros\s+and\s+cons|should\s+i|recommend|best\s+\w+|plan|itinerary|strategy|calculate|solve|prove|derive|equation|debug|fix|optimi[sz]e|what\s+if|theory|theories|lore|meaning\s+of|summari[sz]e|review|evaluate|predict|who\s+would\s+win|stronger|rank)\b/i;
const TECHNICAL = /[=<>{}[\]]|\d+\s*[-+*/^]\s*\d+|\b(?:function|class|error|stack\s*trace|sql|regex|algorithm|integral|derivative|probability)\b/i;

export function wantsDeepThinking(content: string, flags: { visual?: boolean; places?: boolean; composedUI?: boolean; attachments?: boolean } = {}): boolean {
  if (flags.visual || flags.places || flags.composedUI || flags.attachments) return true;
  const text = content.trim();
  if (text.length > 160) return true;
  if (text.length < 12) return false;
  return DEEP_WORDS.test(text) || TECHNICAL.test(text);
}
