import os
import time
import json
import base64
import pyautogui
from PIL import ImageGrab
import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.0-flash")

TASK = "Go to indeed.com and search for 'junior software engineer' jobs in 'Fresno CA'"

def screenshot():
    img = ImageGrab.grab()
    img.save("/tmp/screen.png")
    return img

def ask_gemini(img, task, history):
    history_str = "\n".join(history[-5:])  # last 5 actions for context
    response = model.generate_content([
        img,
        f"""You are a desktop automation agent. 
Task: {task}
Recent actions taken: {history_str}

Look at the screenshot and return ONLY valid JSON, no markdown:
{{"action": "click"|"type"|"hotkey"|"scroll"|"done"|"wait", "x": 0, "y": 0, "text": "", "reasoning": ""}}

Rules:
- click: provide x,y coordinates of what to click
- type: text to type (assumes something is already focused)
- hotkey: e.g. "ctrl+l" to focus address bar
- scroll: x,y to scroll at, use text field for "up" or "down"
- wait: if page is loading
- done: task is complete"""
    ])
    
    raw = response.text.strip().replace("```json", "").replace("```", "")
    return json.loads(raw)

def execute(action):
    a = action["action"]
    if a == "click":
        pyautogui.click(action["x"], action["y"])
    elif a == "type":
        pyautogui.typewrite(action["text"], interval=0.05)
    elif a == "hotkey":
        keys = action["text"].split("+")
        pyautogui.hotkey(*keys)
    elif a == "scroll":
        direction = -3 if action["text"] == "down" else 3
        pyautogui.scroll(direction, x=action["x"], y=action["y"])
    elif a == "wait":
        time.sleep(2)

def run():
    history = []
    print(f"Starting task: {TASK}")
    print("Move mouse to top-left corner to abort (failsafe)")
    
    for step in range(30):  # hard cap at 30 steps
        print(f"\nStep {step + 1}")
        img = screenshot()
        
        try:
            action = ask_gemini(img, TASK, history)
        except Exception as e:
            print(f"Gemini error: {e}, retrying...")
            time.sleep(3)
            continue
        
        print(f"Action: {action['action']} | Reason: {action['reasoning']}")
        
        if action["action"] == "done":
            print("Task complete!")
            break
        
        history.append(f"Step {step+1}: {action['action']} - {action['reasoning']}")
        execute(action)
        time.sleep(1.5)  # let UI settle before next screenshot

if __name__ == "__main__":
    time.sleep(3)  # give you time to alt-tab to the right window
    run()