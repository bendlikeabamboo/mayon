export const QUIZ_FIXTURE = {
	questions: [
		{
			type: 'mcq',
			prompt: 'Which pigment absorbs the light energy that powers photosynthesis?',
			payload: {
				options: ['Chlorophyll a', 'Hemoglobin', 'Cellulose', 'Melanin'],
				answerIndex: 0
			}
		},
		{
			type: 'flashcard',
			prompt: 'Recall the inputs and outputs of the light-dependent reactions.',
			payload: {
				front: 'What does the light-dependent reaction of photosynthesis take in and release?',
				back: 'It takes in water and light energy and releases oxygen, producing ATP and NADPH.'
			}
		},
		{
			type: 'short',
			prompt: 'Name the organelle where photosynthesis takes place in plant cells.',
			payload: {
				rubric: 'A correct answer must name the chloroplast as the organelle where photosynthesis takes place.'
			}
		}
	]
};
