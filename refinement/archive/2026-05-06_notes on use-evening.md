# Notes on Use

# 1
When I input a code block in dark mode, it renders as a code-block. Same with inline code tagged with the backtick delimiter. However, it's using a dark background with dark text so the code becomes unreadable due to low contrast. Instead of using a dark background, let's use a background that is just slightly darker than the current background of the user chat.

# 2
When I prompted Mayon, I said 'Let's create a quiz out of it' and it did create a quiz which I can access. But then it also created a quiz within the same chat. Like it gave me the following reply:

```txt
Quiz is locked and loaded! 🧠 Here we go — 9 questions covering everything from DevOps setup to deployment strategy. A mix of MCQs, flashcards, and short answers.

📝 Question 1 of 9 (MCQ)
What is the relationship between an Azure Subscription and an Azure DevOps Organization?

A) An Azure Subscription is automatically created when you create a DevOps org
B) They are the same thing — one is just the DevOps name for a subscription
C) A DevOps org can only exist inside a subscription's resource group
D) They are separate — a subscription handles billing/resources while a DevOps org handles code/pipelines
Pick your answer! I'll grade as we go through all 9. 😄

Review this, then say next (or paste the error).
```

It seems like it doesn't know that when he calls the tool create a quiz, the tool handles the creation of the quiz and the LLM just has to acknowledge that the tool call succeeded. Maybe this could be broken down into two steps.

## 2.1
When a tool call succeeded, do we inform the LLM that the tool succeeded? Because I think we should and that we should prompt the LLM to expect a confirmation that a quiz was created and also maybe provide a link to the quiz.

## 2.2
Let's use prompt engineering to prevent the LLM from creating the quiz or lab or branch within the chat and instead utilize the tool to do the creation of quiz, labs, and branches.