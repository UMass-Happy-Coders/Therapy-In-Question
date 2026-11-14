from google import genai

from .config import get_settings

client = genai.Client(api_key=get_settings().gemini_api_key)
