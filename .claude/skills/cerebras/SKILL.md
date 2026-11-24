---
name: Cerebras Inference 
description: Use this to write to call an LLM using LiteLlm and OpenAI with the Cerebras Inference provider.
---
# Calling an LLM via Cerebras

These instructions allow you write code to call an LLM with Cerebras specified as the inference provider.  
This method uses LiteLLM and OpenAI.

## Setup

The OPENAI_API_KEY must be set in the .env file and loaded in as an environment variable.  

The uv project must include litellm and pydantic.
`uv add litellm pydantic`

## Code snippets

Use code like these examples in order to use Cerebras.

### Imports and constants

```python
import os
from litellm import completion
MODEL = f"openai/{os.getenv('OPENAI_MODEL', 'gpt-4.1-mini')}"
```

### Code to call via Cerebras for a text response

```python
response = completion(model=MODEL, messages=messages)
result = response.choices[0].message.content
```

### Code to call via Cerebras for a Structured Outputs response

```python
response = completion(model=MODEL, messages=messages, response_format=MyBaseModelSubclass)
result = response.choices[0].message.content
result_as_object = MyBaseModelSubclass.model_validate_json(result)
```