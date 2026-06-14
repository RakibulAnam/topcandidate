// Domain — profile-item normalization ("polished profile").
//
// Converts one raw profile description (possibly Banglish / unstructured) into
// clean professional evidence: canonical English bullets, evidenced skills,
// and coaching gaps. Runs ONCE on profile save (not per generation) so every
// later resume/toolkit generation starts from a stable, pre-cleaned form.

import { NormalizedItemContent } from '../entities/Resume';

// Generic context for any polishable profile item. `title` is the item's
// headline (job role / project name / activity title); `organization` is the
// company or organization when there is one; `technologies` only for projects.
export interface ProfileItemContext {
  kind?: 'experience' | 'project' | 'extracurricular' | 'award';
  title?: string;
  organization?: string;
  technologies?: string;
  // True when `text` is an assembled block of guided-questionnaire answers
  // ("Topic: answer" per line) rather than a free brain dump.
  guided?: boolean;
}

export interface IProfileItemNormalizer {
  normalize(text: string, context: ProfileItemContext): Promise<NormalizedItemContent>;
}

export class NormalizeProfileItemUseCase {
  constructor(private normalizer: IProfileItemNormalizer) {}

  async execute(text: string, context: ProfileItemContext): Promise<NormalizedItemContent> {
    return this.normalizer.normalize(text, context);
  }
}
