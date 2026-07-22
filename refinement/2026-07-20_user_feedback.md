# LLM Summary
When expounding the LLM, prompt to provide a summary, can ruin the experience for user. I think we should have a unchecked by default option when expounding a text that says "Provide Summary" or something so that the user can choose if they want the LLM to still provide a summary. In my case, it just breaks concentration.


# Thought Process
When the LLM is still streaming, there is a generated "Thought Process" button. When I click it, it shows two boxes instead of the expected one box only containing the streaming reasoning tokens.

The location of the first box (which I think is the wrong one) is to the right of the "Thought Process" text and not below it.

For this one I think we should have a container of some sort where it is clear that at one point it is expected to receive streaming tokens and then when we receive the finality, only then it is switched to another type which is basically just the final reasoning tokens.

# Gates
I am seeing 

```
gate
{"nextUnit":"...}
```

at the bottom of the response of the LLM. Let's turn off manually parsed fences in the LLM output, and provide it tools instead which the LLM can call if it wants to present a choice. Let's lean towards prompt engineering for this one as a solution. If a fenced option still slips through, we just render it as such.