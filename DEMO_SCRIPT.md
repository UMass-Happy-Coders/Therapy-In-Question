# Therapy in Question: three-minute website demo

## Before the clock starts

- Run the hand-rehab version of both frontend and backend. Apply its normal database initialization before saving a hand program. Rehearse against isolated demo databases, never the production patient database.
- Use two separate browser profiles: therapist in one, patient in the other. Sign in using the existing demo-account buttons. Keep the patient program page ready in its profile.
- Use a consenting, uninjured presenter for the movement demonstration. The demo settings below are software examples, not a rehabilitation prescription. If you have a hand injury, surgery restrictions, pain, or swelling, do not use a hackathon demo to choose exercises or targets; follow your clinician's instructions.
- Remain seated, with your forearm supported on a table. Position the camera so one whole hand fills the view, including wrist and fingertips. Face the palm toward the camera at a slight angle, with even lighting and a plain background. Keep the same hand in view throughout the set.
- For the live demonstration, use **Seated index finger bends**, **1 set**, **3 reps**, **60-degree target**, **0-second hold**. Confirm during rehearsal that this target is comfortable and tracking is reliable. Never force a finger to reach the displayed target.
- Allow camera access and warm up the hand model during rehearsal. Have a previously completed, clearly labeled rehearsal session available for playback if the live camera fails. Do not present rehearsal data as a live result.
- Gemini encouragement is optional and needs a working API key. The local movement cues, recording, and rep counter do not depend on a successful Gemini response.

## 0:00-0:20 | The problem and homepage

**Show:** The homepage and the project logo.

**Say:**

> One of our teammates keeps spraining their ankle. That made us think about what happens between physical therapy visits. Therapy in Question helps patients follow an assigned home routine and keep a record of what they actually did. Today, I can demonstrate it without leaving this chair.

## 0:20-0:45 | Assign a small hand program

**Show:** Therapist workspace. Name the program **Seated hand demo**. Choose **Seated index finger bends**, set the rehearsed values above, select the demo patient, and click **Save and assign**. Switch to the patient profile and reload its program list.

**Say:**

> The therapist chooses the exercise, sets, repetitions, movement target, and hold. Here I am assigning three gentle index-finger bends. These are demonstration settings, not treatment advice. The patient receives the assigned program rather than asking an AI to prescribe one.

## 0:45-1:05 | Explain the movement before recording

**Show:** Click **Start session** for the assigned program. Show the three illustrated tutorial steps, then click **I am ready - start camera**.

**Say:**

> The camera stays off while the patient learns the movement. I stay seated, support my forearm, gently bend the middle joint of my index finger, and straighten it again. This exercise needs only my hand in view, not my legs or a full-body camera setup.

**Do:** Show one open hand with the index finger gently straight. Keep it still through the five-second countdown.

## 1:05-1:50 | Perform three repetitions

**Show:** The live hand skeleton, finger-angle estimate, movement cue, and rep count. Enable spoken cues if useful. If Gemini is available, enable its encouragement and leave it on during this segment.

**Say:**

> The browser tracks the joints in my hand. A repetition counts after I bend toward the assigned target and return to the open position. The angle is a camera estimate, not a clinical measurement. Local cues respond to the movement; optional Gemini encouragement cannot change the assigned target or give treatment advice.

**Do:** Slowly bend and straighten the index finger three times, pausing briefly at each end. Keep the wrist still and the same hand visible. Do not force the movement. Point to the rep count as it increases.

**If time permits:** Click **Pause exercise**, point out that active time stops, then click **Resume with countdown** and show the open starting position again. Use buttons or Space; hand-raise controls are deliberately absent because this exercise uses the hand itself.

## 1:50-2:15 | Save what actually happened

**Show:** Click **End set**. Show the measured reps, range of motion, and rep times. Enter the presenter's honest pain, difficulty, and comfort scores; optionally add a short note. Click **Save set and finish**.

**Say:**

> The set log combines movement estimates with how the patient felt. These scores are entered by the patient, not inferred from the camera. The summary preserves the reps that were actually counted, including an incomplete set if we stop early.

**Do:** Wait until the recording shows no frames awaiting confirmation before claiming it is saved.

## 2:15-2:40 | Replay the saved hand movement

**Show:** Click **Play skeleton recording**. Play a short segment, pause, move the timeline, and jump to a completed rep.

**Say:**

> This is the saved movement, represented by hand landmarks. We can scrub through it and jump to a counted repetition. We store the skeleton and session measurements, not webcam video or audio. The saved measurements also contribute to the daily and weekly totals.

## 2:40-3:00 | Explain the stack and limits

**Show:** Return to the session summary.

**Say:**

> SvelteKit and FastAPI connect the experience. MediaPipe tracks movement in the browser, MongoDB stores landmark recordings, and TigerData stores repetition metrics and daily and weekly aggregates. Gemini adds optional encouragement. Docker packages the app for Vultr. This is a working prototype for following therapist-assigned practice, not a diagnostic tool or a replacement for a therapist.

## If something fails on stage

- **Camera or model:** End the live attempt honestly. Say, "The live tracker is unavailable; this is our saved rehearsal recording," and open the labeled rehearsal session.
- **Tracking loss:** Stay seated, put the same whole hand back in view, and use **Resume with countdown**. A pause does not mean the exercise has been completed.
- **Fewer than three reps:** Save the actual count and say the set ended early. Do not edit the counter or claim uncounted repetitions.
- **Gemini unavailable:** Say, "Encouragement is optional; the local movement cues still work," and continue.
- **Recording upload failure:** Use **Retry recording**. Do not claim persistence or leave the page while frames are pending. Use the labeled saved rehearsal session if recovery would exceed the demo slot.

## Movement references

- [Cambridge University Hospitals: hand therapy active finger exercises](https://www.cuh.nhs.uk/patient-information/hand-therapy-active-finger-exercises/) describes seated hand positioning and finger middle-joint bending.
- [Physitrack: finger PIP joint flexion/extension](https://us.physitrack.com/home-exercise-video/arom-pip-joints) provides a seated movement reference.

These references inform the movement description, not the prototype's accuracy or an individual exercise prescription. The app tracks the index finger's estimated middle-joint bend as 180 degrees minus the angle between its adjacent world-landmark segments.
