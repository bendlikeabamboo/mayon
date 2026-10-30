I realized that this whole application should be separated into 2 tiers:

1. The data model and execution runtime
2. The web-ui

My problem is that testing new features like for example, let's suppose I want to add a new element to my system prompt called "user background" which is a text area where the user can put his background which the model can use as reference for the user, tailoring the content more to the user's situation.

And then when the AI implements this, it's going to go through the UI using playwright or whatever but in reality, can he just call the data model and execution runtime, right? because that's more LLM friendly because it's just text.

And then web-ui becomes easier to test because the data model and background task is already verified. Right? Does this makes sense?