const Ringer = require('./ringer');
const HandsetSwitch = require('./handsetSwitch');
const Dial = require('./dial');
const SoundOutput = require('./helpers/soundOutput');
const SoundInput = require('./helpers/soundInput');
const SpeechOutput = require('./helpers/speechOutput');
const SpeechInput = require('./helpers/speechInput');
const LLM = require('./helpers/LLM');
const fs = require('fs');
const config = require('./helpers/config');



class Phone{

    randomMessages = [
        "I know what you did last summer",
        "Is that you, Boris?",
        "Look out of the window.",
        "They are on to you.",
        "Look behind you."
        ];
    
    getRandom(min, max) {
        let range = max - min;
        let result = Math.floor(Math.random() * (range)) + min;
        return result;
        }
    /**
     * Generate a timestamped filename with pattern: prefix_yymmdd_hhmmssms.wav
     * @param {string} prefix - filename prefix (e.g., 'mailbox')
     * @returns {string} - full path: ./recordings/prefix_yymmdd_hhmmssms.wav
     */
    getTimestampedFilename(prefix) {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `./recordings/${prefix}_${yy}${mm}${dd}_${hh}${min}${ss}${ms}.wav`;
    }
    
    async delay(timeInMs) {
        return new Promise(async (kept, broken) => {
            setTimeout(async () => {
                return kept("tick");
            }, timeInMs);
        });
    }

    constructor(owner) {
        this.owner = owner;
        this.ringer = new Ringer();
        this.handsetSwitch = new HandsetSwitch(this);
        this.dial = new Dial(this);
        this.soundOutput = new SoundOutput(this);
        this.soundInput = new SoundInput(this);
        this.speechOutput = new SpeechOutput(this);
        this.speechInput = new SpeechInput(this);
        this.llm = new LLM(this);
        this.ringing = false;
        this.ringStart = null;
        this.randomCallStart = null;
        this.recordMessageTimerDate = null;
        this.playbackMessageTimerDate = null;
        this.questionMessageTimer = null;
        this.ringLengthMillis = 10000;
        this.randomCallTimeoutMillis = 10000;
        this.incomingSpeechDelayMillis = 1000;
        this.recordPromptDelayMillis = 1500;
        this.recordMaximumLengthMillis = 20 * 60 * 1000; // max non-mailbox recording length (20 minutes)
        this.receiveRingDelayMillis = 500;
        this.playbackMessageDelayMillis = 0;
        this.playbackMessageTimeoutMillis = 60000;
        this.questionMessageDelayMillis = 0;

        // Mailbox flow timing (wait a few seconds after pickup, then play intro, then record)
        this.mailboxWaitMillis = 2000; // wait after handset picked up before playing intro
        this.mailboxIntroDelayMillis = 1000; // wait after intro before starting recording
        this.mailboxMaximumLengthMillis = 0.5 * 60 * 1000; // max mailbox recording length (20 minutes)
        this.recordingTimeoutMillis = 5000; // grace period after hitting max duration
        this.recordingTimeoutStart = null;

        this.questionText = null;
        this.dialing=false;
        this.recording=false;
        this.message = null;
        this.eventCounter = 0;
        this.updateActive = false;

        // State of the phone
        this.state = "REST";

        // State table for phone
        this.stateActions = {
            REST: {
                'Handset picked up': () => { 
                    this.ringer.ding();
                    return 'PRE_DIAL_TONE'; 
                },
                'Handset replaced': () => { 
                    this.soundOutput.stopPlayback();
                    this.ringer.ding(); 
                    return 'REST'; 
                },
                'Incoming message': (message) => { 
                    this.message = message;
                    this.ringer.startRinging();
                    this.ringStart = new Date();
                    return 'INCOMING_TEXT_MESSAGE_CALL'; 
                },
                'LLM reply received':(message) => { 
                    this.message = message;
                    this.ringer.startRinging();
                    this.ringStart = new Date();
                    return 'INCOMING_TEXT_MESSAGE_CALL'; 
                },
                'Incoming question': (text) => { 
                    this.llm.askAI(text);
                    return 'REST';
                },
                'Test ring requested':() => { 
                    this.ringer.startRinging();
                    this.ringStart = new Date();
                    return 'TEST_RING'; 
                }
            },

            INCOMING_TEXT_MESSAGE_CALL:{
                'Handset picked up': () => { 
                    this.ringer.stopRinging();
                    this.ringStart = new Date();
                    return 'INCOMING_TEXT_MESSAGE_DELAY'; 
                },
                'Timer tick': (date) => { 
                    if(this.ringStart != null){
                        let ringTime = date - this.ringStart;
                        if (ringTime>this.ringLengthMillis){
                            this.ringStart = null;
                            this.ringer.stopRinging();
                            return 'REST';
                        }
                    }
                    return 'INCOMING_TEXT_MESSAGE_CALL'; 
                }
            },

            INCOMING_TEXT_MESSAGE_DELAY : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.ringStart = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.ringStart;
                        if (waitTime>this.incomingSpeechDelayMillis){
                            this.ringStart = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/handsetPickup.wav');
                            return 'INCOMING_TEXT_PICKUP_SOUND_PLAYING';
                        }
                    }
                    return 'INCOMING_TEXT_MESSAGE_DELAY';
                }
            },
            INCOMING_TEXT_PICKUP_SOUND_PLAYING : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.ringStart = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.ringStart;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.questionMessageTimer = new Date();
                            this.soundOutput.stopPlayback();
                            this.speechOutput.say(this.message);
                            return 'INCOMING_SPEECH_PLAYING';
                        }
                    }
                    return 'INCOMING_TEXT_PICKUP_SOUND_PLAYING';
                }
            },
            MESSAGE_RINGING : {
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.ringStart;
                        if (waitTime>this.ringLengthMillis){
                            this.ringer.stopRinging();
                            return 'REST';
                        }
                    }
                    return 'MESSAGE_RINGING';
                },
                'Handset picked up': () => { 
                    this.ringer.stopRinging();
                    this.ringStart = new Date();
                    this.soundOutput.playFile('./sounds/handsetPickup.wav');
                    return 'INCOMING_SPEECH_DELAY'; 
                }
            },

            INCOMING_SPEECH_PLAYING : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.speechOutput.stopSpeaking();
                    return 'REST'; 
                },
                'Timer tick': (date) => { 
                    if(this.playbackMessageTimerDate){
                        let waitTime = date - this.playbackMessageTimerDate;
                        if (waitTime>this.playbackMessageTimeoutMillis){
                            this.playbackMessageTimerDate=null;
                            this.speechOutput.stopSpeaking();
                            this.soundOutput.playFile('./sounds/numberUnobtainable.wav');
                            return 'REST';
                        }
                    }
                    return 'PLAYBACK_SOUND_PLAYING';
                }
            },

            PRE_DIAL_TONE: {
                'Handset replaced': () => {
                    this.soundOutput.stopPlayback();
                    this.ringer.ding();
                    return 'REST';
                },
                'Timer tick': (date) => {
                    this.soundOutput.playFile('./sounds/dialTone.wav');
                    return 'DIAL_TONE';
                }
            },

            DIAL_TONE: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    return 'REST'; 
                },
                'Number dialed': () => { 
                    this.soundOutput.stopPlayback();
                    return 'DIALING'; 
                }
            },

            TEST_RING: {
                'Handset replaced': () => { 
                    this.ringer.stopRinging();
                    return 'REST'; 
                },
                'Test ring ended':() => { 
                    this.ringer.stopRinging();
                    return 'REST'; 
                },               
                'Timer tick': (date) => { 
                    if(this.ringStart != null){
                        let ringTime = date - this.ringStart;
                        if (ringTime>this.ringLengthMillis){
                            this.ringStart = null;
                            this.ringer.stopRinging();
                            return 'REST';
                        }
                    }
                    return 'TEST_RING'; 
                }
            },
            DIALING: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    return 'REST'; },
                'Number dialed (complete)': (number) => { 
                    switch(number){
                        case 1: // Make the phone ring until it is put down
                            this.ringStart = new Date();
                            this.ringer.startRinging();
                            return 'TEST_RING';

                        case 2: // Make a random call
                            this.randomCallStart = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/engagedTone.wav');
                            return 'START_RANDOM_CALL';

                        case 3: // Record a message
                            this.soundOutput.playFile('./sounds/ringingTone.wav');
                            this.recordMessageTimerDate = new Date();
                            this.receiveRingDelayMillis = this.getRandom(1000,3000);
                            return 'MAILBOX_WAIT';
                        case 4: // Playback a message
                            this.soundOutput.playFile('./sounds/ringingTone.wav');
                            this.playbackMessageTimerDate = new Date();
                            this.playbackMessageDelayMillis = this.getRandom(1000,3000);
                            return 'PLAYBACK_PICKUP_DELAY';
                        case 5: // Receive a question
                            this.soundOutput.playFile('./sounds/ringingTone.wav');
                            this.questionMessageTimer = new Date();
                            this.questionMessageDelayMillis = this.getRandom(1000,3000);
                            return 'QUESTION_PICKUP_DELAY';

                        default:// Do nothing
                            this.soundOutput.playFile('./sounds/numberUnobtainable.wav');
                            return 'REST';
                    }
                }
            },
            PLAYBACK_PICKUP_DELAY : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.playbackMessageTimerDate = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if (this.playbackMessageTimerDate){
                        let waitTime = date - this.playbackMessageTimerDate;
                        if (waitTime>this.playbackMessageDelayMillis){
                            this.playbackMessageTimerDate = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/handsetPickup.wav');
                            return 'PLAYBACK_PICKUP_SOUND_PLAYING';
                        }
                    }
                    return 'PLAYBACK_PICKUP_DELAY';
                }
            },            
            PLAYBACK_PICKUP_SOUND_PLAYING: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.recordMessageTimerDate = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.playbackMessageTimerDate){
                        let waitTime = date - this.playbackMessageTimerDate;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.playbackMessageTimerDate=null;
                            this.recordMessageTimerDate = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./recordings/message.wav');
                            return 'PLAYBACK_SOUND_PLAYING';
                        }
                    }
                    return 'PLAYBACK_PICKUP_SOUND_PLAYING';
                }
            },
            PLAYBACK_SOUND_PLAYING : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.recordMessageTimerDate = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.playbackMessageTimerDate){
                        let waitTime = date - this.playbackMessageTimerDate;
                        if (waitTime>this.playbackMessageTimeoutMillis){
                            this.playbackMessageTimerDate=null;
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/numberUnobtainable.wav');
                            return 'REST';
                        }
                    }
                    return 'PLAYBACK_SOUND_PLAYING';
                }
            },
            RECORD_PICKUP_DELAY : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.recordMessageTimerDate = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if (this.recordMessageTimerDate){
                        let waitTime = date - this.recordMessageTimerDate;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.recordMessageTimerDate = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/handsetPickup.wav');
                            return 'RECORD_PICKUP_SOUND_PLAYING';
                        }
                    }
                    return 'RECORD_PICKUP_DELAY';
                }
            },            
            RECORD_PICKUP_SOUND_PLAYING: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.recordMessageTimerDate = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.recordMessageTimerDate){
                        let waitTime = date - this.recordMessageTimerDate;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.recordMessageTimerDate = new Date();
                            this.soundOutput.stopPlayback();
                            this.speechOutput.say("Please leave your message");
                            return 'RECORD_PROMPT_MESSAGE_PLAYING';
                        }
                    }
                    return 'RECORD_PICKUP_SOUND_PLAYING';
                }
            },
            RECORD_PROMPT_MESSAGE_PLAYING : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.recordMessageCallStart = null;
                    return 'REST'; 
                },

                'Timer tick': (date) => {
                    if(this.recordMessageTimerDate){
                        let waitTime = date - this.recordMessageTimerDate;
                        if (waitTime>this.recordPromptDelayMillis){
                            this.recordMessageTimerDate = new Date();
                            // Use configured/default device if present
                            this.startWebRecording(`./recordings/message.wav`);
                            return 'RECORDING_MESSAGE';
                        }
                    }
                    return 'RECORD_PROMPT_MESSAGE_PLAYING';
                }
            },

            // Mailbox flow: after handset pickup
            // The flow is: pickup -> MAILBOX_INTRO -> MAILBOX_WAIT -> MAILBOX_INTRO_PLAYING -> RECORDING_MESSAGE
            MAILBOX_INTRO: {
                // Initialize timer for mailbox flow
                'Handset replaced': () => {
                    // User hung up before mailbox flow started
                    this.recordMessageTimerDate = null;
                    return 'REST';
                },
                'Timer tick': (date) => {
                    // Set the timer and immediately transition to MAILBOX_WAIT
                    this.recordMessageTimerDate = new Date();
                    return 'MAILBOX_WAIT';
                }
            },

            MAILBOX_WAIT: {
                'Handset replaced': () => 'REST',
                'Timer tick': (date) => {
                    if(!this.recordMessageTimerDate) return 'MAILBOX_WAIT';
                    
                    const waitTime = date - this.recordMessageTimerDate;
                    if (waitTime > this.mailboxWaitMillis){
                        const introFile = './sounds/mailbox_ansage.wav';
                        this.recordMessageTimerDate = new Date();
                        this.soundOutput.stopPlayback();
                        
                        // Fetch actual intro duration, fallback to configured delay
                        this._mailboxIntroDelayMillis = this.mailboxIntroDelayMillis;
                        this.soundOutput.getDuration(introFile)
                            .then(durMs => {
                                if (durMs > 0 && durMs < 600000) { // 10 min cap
                                    this._mailboxIntroDelayMillis = durMs;
                                    console.log(`Mailbox intro duration: ${durMs} ms`);
                                }
                            })
                            .catch(err => console.warn(`Mailbox intro duration fetch failed: ${err}`));

                        this.soundOutput.playFile(introFile);
                        return 'MAILBOX_INTRO_PLAYING';
                    }
                    return 'MAILBOX_WAIT';
                }
            },

            MAILBOX_INTRO_PLAYING: {
                // If the handset is replaced during the intro, stop playback and abort
                'Handset replaced': () => {
                    // cancelled during intro
                    this.soundOutput.stopPlayback();
                    // Clear any dynamically computed intro delay
                    this._mailboxIntroDelayMillis = null;
                    return 'REST';
                },
                'Timer tick': (date) => {
                    // Only proceed if we have the intro start timestamp
                    if(this.recordMessageTimerDate){
                        // Compute elapsed time since intro started
                        let waitTime = date - this.recordMessageTimerDate;
                        // Use computed intro duration if available, otherwise fallback to static
                        const introDelay = (typeof this._mailboxIntroDelayMillis === 'number') ? this._mailboxIntroDelayMillis : this.mailboxIntroDelayMillis;
                        // After the intro's duration elapses, start recording
                        if (waitTime>introDelay){
                            // Record the time when recording starts
                            this.recordMessageTimerDate = new Date();
                            // Use a temporary max-recording limit for mailbox recordings
                            this._recordingMaxMillis = this.mailboxMaximumLengthMillis;
                            // Log for debugging - indicates mailbox recording start
                            console.log('Starting mailbox recording');
                            // Start recording to the mailbox file (shared recording state will handle stop)
                            // Use configured/default device if present
                            this.startWebRecording(this.getTimestampedFilename('mailbox'));
                            // Clear the dynamic intro delay now that it's been used
                            this._mailboxIntroDelayMillis = null;
                            // Reuse the shared recording state for mailbox recordings
                            return 'RECORDING_MESSAGE';
                        }
                    }
                    // Continue playing the intro until the delay expires or handset replaced
                    return 'MAILBOX_INTRO_PLAYING';
                }
            },


            RECORDING_MESSAGE:{
                // When handset is replaced while recording, stop recording and clear mailbox temp limits
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundInput.stopRecording();
                    this.recordMessageCallStart = null;
                    // clear any temporary recording limits (e.g., mailbox)
                    this._recordingMaxMillis = null;
                    return 'REST'; 
                },

                'Timer tick': (date) => {
                    // Enforce either the mailbox-specific max or the default record max
                    if(this.recordMessageTimerDate){
                        let waitTime = date - this.recordMessageTimerDate;
                        const maxLen = this._recordingMaxMillis || this.recordMaximumLengthMillis;
                        // If we've exceeded the selected max recording length, stop
                        if (waitTime>maxLen){
                            this.soundInput.stopRecording();
                            this.ringer.ding();
                            // Clear temp mailbox limit if it was set
                            this._recordingMaxMillis = null;
                            // Start timeout state so we do not jump straight to REST
                            this.recordingTimeoutStart = new Date();
                            return 'RECORDING_TIMEOUT';
                        }
                    }
                    // Continue recording
                    return 'RECORDING_MESSAGE';
                }
            },
            START_RANDOM_CALL: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.randomCallDelayMillis = this.getRandom(1000,5000);
                    this.randomCallStart = new Date();
                    return 'RANDOM_CALL_DELAY'; 
                },
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.randomCallStart;
                        if (waitTime>this.randomCallTimeoutMillis){
                            return 'REST';
                        }
                    }
                    return 'START_RANDOM_CALL';
                }
            },
            RANDOM_CALL_DELAY: {
                'Handset picked up': () => { 
                    this.ringer.ding(); 
                    return 'PRE_DIAL_TONE'; 
                },
                'Timer tick': (date) => {
                    if(this.randomCallStart != null){
                        let waitTime = date - this.randomCallStart;
                        if (waitTime>this.randomCallTimeoutMillis){
                            let messageNo = this.getRandom(0,this.randomMessages.length);
                            this.message = this.randomMessages[messageNo];
                            this.ringStart = new Date();
                            this.ringer.startRinging();
                            return 'MESSAGE_RINGING';
                        }
                    }
                    return 'RANDOM_CALL_DELAY';
                }
            },
            MESSAGE_RINGING : {
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.ringStart;
                        if (waitTime>this.ringLengthMillis){
                            this.ringer.stopRinging();
                            return 'REST';
                        }
                    }
                    return 'MESSAGE_RINGING';
                },
                'Handset picked up': () => { 
                    this.ringer.stopRinging();
                    this.ringStart = new Date();
                    this.soundOutput.playFile('./sounds/handsetPickup.wav');
                    return 'INCOMING_SPEECH_DELAY'; 
                }
            },
            INCOMING_SPEECH_DELAY : {
                'Timer tick': (date) => {
                    if(this.ringStart != null){
                        let waitTime = date - this.ringStart;
                        if (waitTime>this.incomingSpeechDelayMillis){
                            this.speechOutput.say(this.message);
                            return 'PLAYING_SPEECH_MESSAGE';
                        }
                    }
                    return 'INCOMING_SPEECH_DELAY';
                }
            },
            PLAYING_SPEECH_MESSAGE : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    return 'REST'; }
            },
            QUESTION_PICKUP_DELAY : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.questionMessageTimer = null;
                    return 'REST'; 
                },

                'Timer tick': (date) => {
                    if (this.questionMessageTimer){
                        let waitTime = date - this.questionMessageTimer;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.questionMessageTimer = new Date();
                            this.soundOutput.stopPlayback();
                            this.soundOutput.playFile('./sounds/handsetPickup.wav');
                            return 'QUESTION_PICKUP_SOUND_PLAYING';
                        }
                    }
                    return 'QUESTION_PICKUP_DELAY';
                }
            },
            QUESTION_PICKUP_SOUND_PLAYING: {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.questionMessageTimer = null;
                    return 'REST'; 
                },
                'Timer tick': (date) => {
                    if(this.questionMessageTimer){
                        let waitTime = date - this.questionMessageTimer;
                        if (waitTime>this.receiveRingDelayMillis){
                            this.questionMessageTimer = new Date();
                            this.soundOutput.stopPlayback();
                            this.speechOutput.say("Ask your question");
                            return 'QUESTION_PROMPT_MESSAGE_PLAYING';
                        }
                    }
                    return 'QUESTION_PICKUP_SOUND_PLAYING';
                }
            },
            QUESTION_PROMPT_MESSAGE_PLAYING : {
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.stopPlayback();
                    this.questionMessageTimer = null;
                    return 'REST'; 
                },

                'Timer tick': (date) => {
                    if(this.questionMessageTimer){
                        let waitTime = date - this.questionMessageTimer;
                        if (waitTime>this.recordPromptDelayMillis){
                            this.questionMessageTimer = new Date();
                            // Use configured/default device if present
                            this.startWebRecording(`./recordings/question.wav`);
                            return 'RECORDING_QUESTION';
                        }
                    }
                    return 'QUESTION_PROMPT_MESSAGE_PLAYING';
                }
            },
            RECORDING_QUESTION:{
                'Handset replaced': () => { 
                    this.ringer.ding(); 
                    this.soundInput.stopRecording();
                    this.speechInput.startSpeechDecode(`./recordings/question.wav`);
                    this.questionMessageTimer = new Date();
                    return 'DOING_SPEECH_TO_TEXT'; 
                },

                'Timer tick': (date) => {
                    if(this.questionMessageTimer){
                        let waitTime = date - this.questionMessageTimer;
                        if (waitTime>this.recordMaximumLengthMillis){
                            this.soundInput.stopRecording();
                            this.ringer.ding();
                            this.recordingTimeoutStart = new Date();
                            return 'RECORDING_TIMEOUT';
                        }
                    }
                    return 'RECORDING_QUESTION';
                }
            },
            RECORDING_TIMEOUT: {
                'Handset replaced': () => {
                    this.ringer.ding();
                    this.recordingTimeoutStart = null;
                    return 'REST';
                },
                'Timer tick': (date) => {
                    // After a short grace period, fall back to REST even if handset not replaced
                    if (this.recordingTimeoutStart && (date - this.recordingTimeoutStart) > this.recordingTimeoutMillis) {
                        this.recordingTimeoutStart = null;
                        return 'REST';
                    }
                    return 'RECORDING_TIMEOUT';
                }
            },
            DOING_SPEECH_TO_TEXT:{
                'Handset picked up': () => { 
                    this.ringer.ding(); 
                    this.soundOutput.playFile('./sounds/dialTone.wav');
                    return 'DIAL_TONE'; 
                },
                'Text decoded': (text) => {
                    this.questionText = text;
                    console.log(`Speech decoded successfully: ${text}`);
                    this.llm.askAI(text);
                    return 'REST';
                }
            },
            COMMAND_EXECUTION: {
                'Handset replaced': () => { stopCurrentCommand(); return 'REST'; },
                'Timeout (30 sec)': () => { stopCurrentCommand(); return 'REST'; },
                'Command execution complete': () => { return 'REST'; }
            },
            WAITING_FOR_RESPONSE: {
                'Handset picked up': () => { stopRinging(); playResponse(); return 'REST'; },
                'Handset replaced': () => { return 'REST'; },
                'Server response received': () => { ringBell(); return 'WAITING_FOR_PICKUP'; }
            },
            WAITING_FOR_PICKUP: {
                'Handset picked up': () => { stopRinging(); playResponse(); return 'REST'; },
                'Handset replaced': () => { return 'REST'; },
                'Timeout (30 sec)': () => { stopRinging(); return 'REST'; }
            }
        };

        // Start the heartbeat
        setInterval(() => {
            this.update();
            }, 500);
    }

    // Master event handler
    handleEvent(event, data = null) {
        this.eventCounter++;
        //console.log(`${this.eventCounter} Event '${event}' fired in state '${this.state}'`);
        if (this.stateActions[this.state] && this.stateActions[this.state][event]) {
        this.state = this.stateActions[this.state][event](data);
        console.log(`   state changed to '${this.state}'`);
        }
    }

    // Bindings to the phone events

    handsetPickedUp(){
        this.handleEvent('Handset picked up');
    }

    handsetPutDown(){
        this.handleEvent('Handset replaced');
    }

    dialStarted(){
        this.handleEvent('Number dialed');
    }

    numberDialed(number){
        this.handleEvent('Number dialed (complete)',number);
        return;
    }

      // Start recording via web UI (accept optional options object e.g. { device: 'plughw:3,0' })
    startWebRecording(filename, opts = {}) {
        // Determine device: explicit option -> configured default -> env var -> undefined
        const device = opts.device || config.get('soundDevice') || process.env.SOUND_DEVICE;
        if (device){
          this.soundInput.startRecording(filename, { device });
        } else {
          this.soundInput.startRecording(filename, {});
        }
        this.recording = true;
    }

    // Stop recording via web UI and return length in ms (or null)
    stopWebRecording() {
        this.soundInput.stopRecording();
        this.recording = false;
        return this.soundInput.getRecordingLengthInMillis();
    }
    
    acceptMessage(message){
        this.handleEvent('Incoming message',message);
    }

    acceptQuestion(question){
        this.handleEvent('Incoming question',question);
    }

    speechDecodedSuccessfully(text){
        this.handleEvent('Text decoded',text);
    }

    LLMReplyReceived(text){
        console.log(`Got LLM reply ${text}`);
        this.handleEvent('LLM reply received',text);
    }
    
    update(){
        if(this.updateActive){
            console.log("  *****");
            return;
        }
        this.updateActive = true;
        let date = new Date();
        this.handleEvent('Timer tick', date);
        this.updateActive = false;
    }

    ding(){
        this.ringer.ding();
    }


    dialPulse(){
    }

    startRinging()
    {
        this.handleEvent('Test ring requested');
    }

    stopRinging(){
        this.handleEvent('Test ring ended');
    }

}

module.exports = Phone;
