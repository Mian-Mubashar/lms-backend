const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const {
  Course,
  Enrollment,
  CourseMaterial,
  User,
  Assignment,
  AssignmentSubmission,
  Quiz
} = require('../models');

const router = express.Router();

const envFileCache = {};
const readEnvFile = (filename) => {
  if (Object.prototype.hasOwnProperty.call(envFileCache, filename)) {
    return envFileCache[filename];
  }
  try {
    const content = fs.readFileSync(path.resolve(process.cwd(), filename), 'utf8');
    const parsed = dotenv.parse(content);
    envFileCache[filename] = parsed;
    return parsed;
  } catch (error) {
    envFileCache[filename] = {};
    return {};
  }
};

const resolveEnvValue = (key) => {
  const runtimeValue = process.env[key];
  if (typeof runtimeValue === 'string' && runtimeValue.trim()) {
    return runtimeValue.trim();
  }

  const runtimeFileValue = readEnvFile('.env.runtime')[key];
  if (typeof runtimeFileValue === 'string' && runtimeFileValue.trim()) {
    return runtimeFileValue.trim();
  }

  const envValue = readEnvFile('.env')[key];
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }

  return '';
};

let openai = null;
let openaiApiKeyCache = '';
const getOpenAIClient = () => {
  const key = resolveEnvValue('OPENAI_API_KEY');
  if (!key) {
    openai = null;
    openaiApiKeyCache = '';
    return null;
  }

  if (openai && openaiApiKeyCache === key) {
    return openai;
  }

  openai = new OpenAI({ apiKey: key });
  openaiApiKeyCache = key;
  return openai;
};

/** OpenAI chat often wraps JSON in markdown; model may add prose — extract object safely. */
function parseAssistantJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch (_) {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch (_) {
        /* ignore */
      }
    }
  }
  return null;
}

// Lazy initialization function for Pinecone
let pinecone = null;
let pineconeApiKeyCache = '';
const getPinecone = () => {
  const pineconeApiKey = resolveEnvValue('PINECONE_API_KEY');
  if (pinecone) {
    if (pineconeApiKey && pineconeApiKey === pineconeApiKeyCache) {
      return pinecone;
    }
    pinecone = null;
    pineconeApiKeyCache = '';
  }
  
  if (!pineconeApiKey) {
    return pinecone;
  }

  try {
    // For newer Pinecone SDK (v1.x), only API key is needed
    pinecone = new Pinecone({
      apiKey: pineconeApiKey
    });
    pineconeApiKeyCache = pineconeApiKey;
    return pinecone;
  } catch (error) {
    console.warn('Pinecone initialization failed:', error.message);
    console.warn('AI RAG features will not be available');
    return null;
  }
};

router.use(authenticate);

/**
 * @route   POST /api/ai/chat
 * @desc    Chat with AI assistant (RAG)
 * @access  Private
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, courseId } = req.body;
    const openaiClient = getOpenAIClient();
    const pineconeIndexName = resolveEnvValue('PINECONE_INDEX_NAME') || resolveEnvValue('PINECONE_INDEX');

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const buildLocalFallbackResponse = async () => {
      const normalized = String(message || '').trim().toLowerCase();
      const tips = [];

      if (normalized.includes('quiz')) {
        tips.push('For quiz prep: review key definitions, practice 5 MCQs per concept, and write short self-check notes.');
      }
      if (normalized.includes('assignment')) {
        tips.push('For assignments: break work into problem statement, approach, implementation, testing, and short conclusion.');
      }
      if (normalized.includes('attendance')) {
        tips.push('For attendance tracking: record status daily and keep notes concise, factual, and action-oriented.');
      }
      if (normalized.includes('exam') || normalized.includes('test')) {
        tips.push('For exams: use spaced revision, timed practice, and error logs to target weak areas.');
      }

      let courseHint = '';
      if (courseId) {
        const course = await Course.findById(courseId).select('title description').lean();
        if (course) {
          courseHint = `Course context: ${course.title}${course.description ? ` - ${String(course.description).slice(0, 180)}` : ''}.`;
        }
      }

      const defaultTip = 'I can still help without external AI. Ask for summary, study plan, quiz practice, assignment outline, or explanation of a topic.';
      return [
        'AI service is currently in local fallback mode.',
        courseHint || '',
        tips.length ? tips.join(' ') : defaultTip
      ].filter(Boolean).join('\n\n');
    };

    // Get relevant course materials if courseId is provided
    let context = '';
    if (courseId && pineconeIndexName && openaiClient) {
      // Check if user has access to this course
      if (req.user.role === 'student') {
        const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId }).lean();
        if (!enrollment) {
          return res.status(403).json({ message: 'Access denied' });
        }
      }

      // Get course materials
      await CourseMaterial.find({ courseId }).select('_id').lean();

      try {
        // Lazy initialize Pinecone
        const pineconeClient = getPinecone();
        if (!pineconeClient) {
          throw new Error('Pinecone not configured');
        }
        
        // Search Pinecone for relevant embeddings
        const index = pineconeClient.index(pineconeIndexName);
        
        // Generate embedding for the query
        const embeddingResponse = await openaiClient.embeddings.create({
          model: 'text-embedding-ada-002',
          input: message
        });

        const queryEmbedding = embeddingResponse.data[0].embedding;

        // Search Pinecone
        const queryResponse = await index.query({
          vector: queryEmbedding,
          topK: 5,
          includeMetadata: true,
          filter: { courseId: { $eq: courseId.toString() } }
        });

        // Build context from retrieved documents
        if (queryResponse.matches && queryResponse.matches.length > 0) {
          context = queryResponse.matches
            .map(match => match.metadata?.text || '')
            .join('\n\n');
        }
      } catch (pineconeError) {
        console.warn('Pinecone search failed, continuing without context:', pineconeError.message);
        // Continue without RAG context if Pinecone fails
      }
    }

    // Build prompt with context
    const systemPrompt = `You are an AI teaching assistant for a Learning Management System. 
    ${courseId ? 'You have access to course materials and should use them to provide accurate answers.' : ''}
    Be helpful, clear, and educational. If you don't know something, say so.`;

    const userPrompt = courseId && context
      ? `Context from course materials:\n${context}\n\nUser question: ${message}`
      : message;

    // Generate response using OpenAI
    if (!openaiClient) {
      const localResponse = await buildLocalFallbackResponse();
      return res.json({ response: localResponse, source: 'fallback' });
    }

    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      const response = completion.choices[0].message.content;
      return res.json({ response, source: 'openai' });
    } catch (openaiError) {
      console.warn('OpenAI chat failed, using fallback:', openaiError.message);
      const localResponse = await buildLocalFallbackResponse();
      return res.json({ response: localResponse, source: 'fallback' });
    }
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/process-pdf
 * @desc    Process PDF and create embeddings
 * @access  Private/Teacher,Admin
 */
router.post('/process-pdf', async (req, res) => {
  try {
    const { courseId, materialId } = req.body;
    const openaiClient = getOpenAIClient();
    const pineconeIndexName = resolveEnvValue('PINECONE_INDEX_NAME') || resolveEnvValue('PINECONE_INDEX');

    if (!courseId || !materialId) {
      return res.status(400).json({ message: 'Course ID and Material ID are required' });
    }

    if (!openaiClient) {
      return res.status(503).json({ message: 'OpenAI API is not configured' });
    }

    if (!pineconeIndexName) {
      return res.status(503).json({ message: 'Pinecone is not configured' });
    }

    // Get material
    const material = await CourseMaterial.findOne({ _id: materialId, courseId }).lean();
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }

    // Read PDF file
    const pdfBuffer = fs.readFileSync(material.filePath);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    // Split text into chunks (approximately 1000 characters each)
    const chunkSize = 1000;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    // Lazy initialize Pinecone
    const pineconeClient = getPinecone();
    if (!pineconeClient) {
      return res.status(503).json({ message: 'Pinecone is not configured' });
    }

    // Generate embeddings for each chunk
    const index = pineconeClient.index(pineconeIndexName);
    const vectors = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Generate embedding
      const embeddingResponse = await openaiClient.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunk
      });

      const embedding = embeddingResponse.data[0].embedding;

      // Prepare vector for Pinecone
      vectors.push({
        id: `${materialId}-chunk-${i}`,
        values: embedding,
        metadata: {
          courseId: courseId.toString(),
          materialId: materialId.toString(),
          chunkIndex: i,
          text: chunk,
          title: material.title
        }
      });
    }

    // Upsert to Pinecone
    await index.upsert(vectors);

    res.json({ 
      message: 'PDF processed successfully', 
      chunksProcessed: chunks.length 
    });
  } catch (error) {
    console.error('Process PDF error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/text-to-speech
 * @desc    Convert text to speech using OpenAI
 * @access  Private
 */
router.post('/text-to-speech', async (req, res) => {
  try {
    const { text, voice = 'alloy' } = req.body;
    const openaiClient = getOpenAIClient();

    if (!text) {
      return res.status(400).json({ message: 'Text is required' });
    }

    let buffer;
    let audioFormat = 'mp3';

    if (!openaiClient) {
      return res.status(503).json({
        message: 'OpenAI API is not configured. Please add OPENAI_API_KEY in .env or .env.runtime file'
      });
    }
    const mp3 = await openaiClient.audio.speech.create({
      model: 'tts-1',
      voice: voice,
      input: text.substring(0, 4096)
    });

    buffer = Buffer.from(await mp3.arrayBuffer());
    audioFormat = 'mp3';

    // Instead of saving to the filesystem (which fails on Vercel's read-only filesystem),
    // we return the audio as a Base64 data URI so the frontend can play it directly.
    const base64Audio = buffer.toString('base64');
    const audioDataUri = `data:audio/${audioFormat};base64,${base64Audio}`;

    res.json({ 
      audioUrl: audioDataUri,
      provider: 'openai',
      format: audioFormat,
      message: 'Text converted to speech successfully using OpenAI'
    });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      details: error.response?.data || null
    });
  }
});

/**
 * @route   POST /api/ai/generate-course-description
 * @desc    Generate AI course description
 * @access  Private/Teacher,Admin
 */
router.post('/generate-course-description', async (req, res) => {
  try {
    const { title, category, audience = 'students', level = 'beginner' } = req.body;
    const openaiClient = getOpenAIClient();

    if (!title) {
      return res.status(400).json({ message: 'Course title is required' });
    }

    // Fallback if OpenAI is not configured
    if (!openaiClient) {
      const fallbackDescription = `${title} is a ${level}-friendly ${category || 'learning'} course designed for ${audience}. 
You will learn practical concepts step by step with hands-on tasks, guided examples, and short assessments.
By the end of this course, learners will be able to apply the key skills confidently in real-world scenarios.`;

      return res.json({ description: fallbackDescription.trim(), source: 'fallback' });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert instructional designer. Write concise, professional course descriptions for LMS.'
        },
        {
          role: 'user',
          content: `Generate a professional LMS course description in 90-140 words.
Title: ${title}
Category: ${category || 'General'}
Audience: ${audience}
Level: ${level}

Return plain text only.`
        }
      ],
      temperature: 0.7,
      max_tokens: 220
    });

    return res.json({
      description: completion.choices[0].message.content.trim(),
      source: 'openai'
    });
  } catch (error) {
    console.error('Generate course description error:', error);
    const { title, category, audience = 'students', level = 'beginner' } = req.body || {};
    if (title) {
      const fallbackDescription = `${title} is a ${level}-friendly ${category || 'learning'} course designed for ${audience}. 
You will learn practical concepts step by step with hands-on tasks, guided examples, and short assessments.
By the end of this course, learners will be able to apply the key skills confidently in real-world scenarios.`;
      return res.json({ description: fallbackDescription.trim(), source: 'fallback_on_error' });
    }
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/generate-quiz-questions
 * @desc    Generate quiz questions with AI
 * @access  Private/Teacher,Admin
 */
router.post('/generate-quiz-questions', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const {
      topic,
      difficulty = 'medium',
      count = 5,
      questionType = 'multiple_choice',
      generationMode = 'accurate'
    } = req.body;

    if (!topic) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const normalizedCount = Math.min(Math.max(Number(count) || 5, 1), 10);
    const mode = ['fast', 'accurate', 'exam'].includes(generationMode) ? generationMode : 'accurate';
    const buildFallbackQuestions = () => {
      const starters = [
        'Which statement best describes',
        'What is the primary purpose of',
        'Which option is most accurate about',
        'Which scenario correctly applies',
        'What is a key benefit of',
        'Which step should be done first in',
        'What is the most common mistake in',
        'Which concept is directly related to'
      ];

      const topicWords = topic
        .split(/\s+/)
        .map((w) => w.trim())
        .filter(Boolean);
      const firstTopicWord = topicWords[0] || 'the topic';

      return Array.from({ length: normalizedCount }).map((_, index) => {
        const stem = `${starters[index % starters.length]} ${topic}?`;
        const answer = `${topic} concept ${index + 1}`;

        if (questionType === 'true_false') {
          return {
            question: `${stem} (True/False)`,
            questionType: 'true_false',
            options: [],
            correctAnswer: index % 2 === 0 ? 'True' : 'False',
            points: 1
          };
        }

        if (questionType === 'short_answer') {
          return {
            question: stem,
            questionType: 'short_answer',
            options: [],
            correctAnswer: `${firstTopicWord} explanation ${index + 1}`,
            points: 1
          };
        }

        const options = [
          answer,
          `${firstTopicWord} misconception ${index + 1}`,
          `${firstTopicWord} unrelated fact ${index + 1}`,
          `${firstTopicWord} partial truth ${index + 1}`
        ];

        return {
          question: stem,
          questionType: 'multiple_choice',
          options,
          correctAnswer: answer,
          points: 1
        };
      });
    };

    const normalizeAndDedupe = (rawQuestions) => {
      const seen = new Set();
      const normalized = [];

      for (const q of rawQuestions) {
        const questionText = (q.question || '').trim();
        if (!questionText) {
          continue;
        }
        const dedupeKey = questionText.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        const qType = q.questionType || questionType;
        let options = Array.isArray(q.options) ? q.options.filter(Boolean) : [];
        let correctAnswer = q.correctAnswer || '';

        if (qType === 'multiple_choice') {
          if (options.length < 4) {
            const fallback = buildFallbackQuestions().find((item) => item.questionType === 'multiple_choice');
            options = fallback ? fallback.options : ['Option A', 'Option B', 'Option C', 'Option D'];
          }
          if (!correctAnswer || !options.includes(correctAnswer)) {
            correctAnswer = options[0];
          }
        } else {
          options = [];
          if (!correctAnswer) {
            correctAnswer = qType === 'true_false' ? 'True' : 'Sample answer';
          }
        }

        normalized.push({
          question: questionText,
          questionType: qType,
          options,
          correctAnswer,
          points: Number(q.points) > 0 ? Number(q.points) : 1
        });
      }

      if (normalized.length < normalizedCount) {
        const fallbackExtra = buildFallbackQuestions();
        for (const q of fallbackExtra) {
          if (normalized.length >= normalizedCount) break;
          const key = q.question.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          normalized.push(q);
        }
      }

      return normalized.slice(0, normalizedCount);
    };

    // Fallback data if OpenAI is not configured
    if (!openaiClient) {
      return res.json({ questions: buildFallbackQuestions(), source: 'fallback_no_openai' });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You generate valid JSON quiz questions for LMS.
Return ONLY JSON array. No markdown, no explanation.
All questions MUST be unique (no duplicates or paraphrase duplicates).
Schema for each item:
{
  "question": "string",
  "questionType": "multiple_choice|true_false|short_answer",
  "options": ["string"] (for multiple_choice exactly 4 realistic options),
  "correctAnswer": "string",
  "points": 1
}`
        },
        {
          role: 'user',
          content: `Generate ${normalizedCount} ${difficulty} ${questionType} questions about: ${topic}.
For multiple choice, provide 4 distinct options and ensure correctAnswer exactly matches one option.
Generation mode: ${mode}.
- fast: concise and straightforward
- accurate: conceptually correct and practical
- exam: scenario-based and analytical`
        }
      ],
      temperature: mode === 'fast' ? 0.5 : mode === 'exam' ? 0.8 : 0.65,
      max_tokens: 1200
    });

    let parsedQuestions = [];
    const raw = completion.choices[0].message.content.trim();
    try {
      parsedQuestions = JSON.parse(raw);
    } catch (parseError) {
      console.warn('AI question parse failed, using fallback parser:', parseError.message);
      try {
        const sanitized = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        parsedQuestions = JSON.parse(sanitized);
      } catch (secondParseError) {
        console.warn('Sanitized parse failed, using generated fallback questions:', secondParseError.message);
        parsedQuestions = buildFallbackQuestions();
      }
    }

    const normalizedQuestions = normalizeAndDedupe(parsedQuestions);

    return res.json({ questions: normalizedQuestions, source: 'openai', mode });
  } catch (error) {
    console.error('Generate quiz questions error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/generate-assignment-template
 * @desc    Generate assignment title/description/instructions
 * @access  Private/Teacher,Admin
 */
router.post('/generate-assignment-template', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const {
      topic,
      courseTitle = '',
      level = 'intermediate',
      assignmentType = 'practical',
      learningOutcome = '',
      existingDescription = '',
      generationMode = 'balanced'
    } = req.body;
    if (!topic) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const normalizedLevel = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate';
    const normalizedType = ['practical', 'theory', 'project', 'case-study'].includes(assignmentType)
      ? assignmentType
      : 'practical';
    const mode = ['strict', 'balanced', 'creative'].includes(generationMode) ? generationMode : 'balanced';

    if (!openaiClient) {
      const fallbackTitlePrefix = normalizedType === 'project'
        ? 'Mini Project'
        : normalizedType === 'case-study'
          ? 'Case Study'
          : normalizedType === 'theory'
            ? 'Theory Task'
            : 'Practical Assignment';
      return res.json({
        source: 'fallback',
        title: `${topic} ${fallbackTitlePrefix}`,
        description: `Complete a ${normalizedLevel}-level ${normalizedType} assignment on "${topic}" for ${courseTitle || 'this course'}.`,
        instructions: [
          `1) Review key concepts related to ${topic}`,
          normalizedType === 'theory'
            ? '2) Write a structured explanation with examples and references'
            : '2) Build a clear solution with proper structure and assumptions',
          '3) Submit your work with concise reasoning and expected outcomes'
        ].join('\n'),
        rubric: [
          'Concept accuracy (40%)',
          'Clarity and structure (30%)',
          'Practical relevance (30%)'
        ]
      });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an LMS curriculum designer.
Return ONLY valid JSON with keys:
title (string), description (string), instructions (string), rubric (array of 3-5 short strings).
Rules:
- Make content specific, not generic.
- Mention concrete task scope and expected deliverable.
- Avoid repeating prior wording if previous draft is provided.
- Description 50-90 words.
- Instructions must be a numbered multi-step text (3-6 steps).`
        },
        {
          role: 'user',
          content: `Create one ${normalizedLevel} ${normalizedType} assignment.
Topic: "${topic}"
Course: "${courseTitle || 'General LMS Course'}"
Primary learning outcome: "${learningOutcome || 'Apply core concepts in a realistic scenario'}"
Generation mode: ${mode}
Previous draft to avoid repeating: "${existingDescription || 'none'}"
Style guidance:
- strict = highly structured and objective
- balanced = practical and clear
- creative = scenario-driven and engaging`
        }
      ],
      temperature: mode === 'strict' ? 0.45 : mode === 'creative' ? 0.8 : 0.65,
      max_tokens: 420
    });

    const raw = completion.choices[0].message.content.trim();
    const sanitized = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(sanitized);
    return res.json({
      title: parsed.title || `${topic} Assignment`,
      description: parsed.description || `Complete a ${normalizedType} task on ${topic}.`,
      instructions: parsed.instructions || '1) Review concepts\n2) Complete task\n3) Submit with explanation',
      rubric: Array.isArray(parsed.rubric) ? parsed.rubric : [],
      source: 'openai',
      mode
    });
  } catch (error) {
    console.error('Generate assignment template error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/suggest-attendance-note
 * @desc    Generate attendance note text
 * @access  Private/Teacher,Admin
 */
router.post('/suggest-attendance-note', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const { status, studentName = 'student', context = '' } = req.body;
    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const fallbackByStatus = {
      present: `${studentName} attended class on time and participated appropriately.`,
      absent: `${studentName} was absent today; follow-up recommended to maintain continuity.`,
      late: `${studentName} arrived late to class and was advised to improve punctuality.`,
      excused: `${studentName} absence was excused based on provided reason.`
    };
    const fallback = fallbackByStatus[status] || `${studentName} attendance recorded as ${status}.`;
    if (!openaiClient) {
      return res.json({ note: fallback, source: 'fallback' });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an academic admin assistant. Write exactly one professional attendance note in 12-22 words. Do not include bullets, labels, or emojis.'
        },
        {
          role: 'user',
          content: `Student: ${studentName}. Status: ${status}. Extra context (optional): ${context || 'none'}`
        }
      ],
      temperature: 0.35,
      max_tokens: 70
    });

    return res.json({ note: completion.choices[0].message.content.trim(), source: 'openai' });
  } catch (error) {
    console.error('Suggest attendance note error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/dashboard-insights
 * @desc    Generate role-based dashboard insights
 * @access  Private
 */
router.post('/dashboard-insights', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const { analytics = {}, role = req.user.role } = req.body;
    const summaryText = JSON.stringify(analytics);

    if (!openaiClient) {
      return res.json({
        source: 'fallback',
        insights: [
          'Review low-performing areas and prioritize improvement actions.',
          'Focus on consistency: keep regular assignment/quiz cadence.',
          'Track progress weekly and intervene early where needed.'
        ]
      });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are an LMS analyst. Return ONLY JSON array of 3 concise actionable insights.' },
        { role: 'user', content: `Role: ${role}\nAnalytics: ${summaryText}` }
      ],
      temperature: 0.6,
      max_tokens: 220
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());

    const normalizedInsights = (Array.isArray(parsed) ? parsed : [])
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item && typeof item === 'object') {
          return (item.insight || item.text || item.recommendation || '').toString().trim();
        }
        return '';
      })
      .filter(Boolean)
      .slice(0, 3);

    if (normalizedInsights.length === 0) {
      return res.json({
        source: 'fallback_on_parse',
        insights: [
          'Review low-performing areas and prioritize improvement actions.',
          'Focus on consistency: keep regular assignment/quiz cadence.',
          'Track progress weekly and intervene early where needed.'
        ]
      });
    }

    return res.json({ source: 'openai', insights: normalizedInsights });
  } catch (error) {
    console.error('Dashboard insights error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/pro-studio
 * @desc    Advanced AI workflow generator for teachers/students
 * @access  Private
 */
router.post('/pro-studio', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const {
      feature = 'lesson-plan',
      topic = '',
      context = '',
      audience = 'students',
      level = 'intermediate'
    } = req.body;

    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const normalizedFeature = ['lesson-plan', 'question-bank', 'intervention-plan'].includes(feature)
      ? feature
      : 'lesson-plan';
    const normalizedLevel = ['beginner', 'intermediate', 'advanced'].includes(level)
      ? level
      : 'intermediate';

    const fallbackPayloads = {
      'lesson-plan': {
        title: `${topic} - Smart Lesson Plan`,
        sections: [
          'Learning objectives and expected outcomes',
          'Warm-up activity and concept activation',
          'Core teaching flow with examples',
          'Hands-on task and peer discussion',
          'Exit-ticket assessment and recap'
        ],
        checklist: [
          'Define outcomes in measurable form',
          'Include at least one practical activity',
          'Add 5-minute understanding check'
        ],
        nextActions: [
          'Share plan with class group',
          'Prepare slides and practice worksheet',
          'Schedule follow-up quiz'
        ]
      },
      'question-bank': {
        title: `${topic} - Assessment Blueprint`,
        sections: [
          'Concept coverage matrix (easy/medium/hard)',
          'MCQ pool strategy with distractor quality',
          'Short-answer prompts with scoring notes',
          'Scenario-based analytical questions'
        ],
        checklist: [
          'Map each question to learning outcome',
          'Avoid duplicates or paraphrase duplicates',
          'Keep answer key reviewed and validated'
        ],
        nextActions: [
          'Generate 15 mixed-difficulty questions',
          'Pilot test with 2-3 students',
          'Finalize rubric and marking guide'
        ]
      },
      'intervention-plan': {
        title: `${topic} - Student Intervention Plan`,
        sections: [
          'Identify performance gaps from recent results',
          'Segment students by support need',
          'Targeted remediation activities',
          'Weekly progress monitoring checkpoints'
        ],
        checklist: [
          'Set measurable short-term goals',
          'Assign mentor/support slots',
          'Track attendance and completion consistency'
        ],
        nextActions: [
          'Run 2 focused support sessions',
          'Share personalized feedback notes',
          'Re-evaluate with mini-quiz next week'
        ]
      }
    };

    if (!openaiClient) {
      return res.json({ source: 'fallback', feature: normalizedFeature, ...fallbackPayloads[normalizedFeature] });
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an advanced LMS copilot.
Return ONLY valid JSON object:
{
  "title": "string",
  "sections": ["string"],
  "checklist": ["string"],
  "nextActions": ["string"]
}
Rules:
- Output concise, practical, and implementation-oriented content.
- sections length: 4-6
- checklist length: 3-5
- nextActions length: 3-5`
        },
        {
          role: 'user',
          content: `Generate a ${normalizedFeature} for:
Topic: ${topic}
Audience: ${audience}
Level: ${normalizedLevel}
Context: ${context || 'none'}`
        }
      ],
      temperature: 0.6,
      max_tokens: 700
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());
    return res.json({
      source: 'openai',
      feature: normalizedFeature,
      title: parsed.title || fallbackPayloads[normalizedFeature].title,
      sections: Array.isArray(parsed.sections) ? parsed.sections : fallbackPayloads[normalizedFeature].sections,
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist : fallbackPayloads[normalizedFeature].checklist,
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : fallbackPayloads[normalizedFeature].nextActions
    });
  } catch (error) {
    console.error('AI pro studio error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/exam-lab
 * @desc    Generate scenario tasks and evaluate answers
 * @access  Private
 */
router.post('/exam-lab', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const {
      mode = 'generate',
      topic = '',
      level = 'intermediate',
      promptContext = '',
      question = '',
      studentAnswer = ''
    } = req.body;

    const normalizedMode = ['generate', 'evaluate'].includes(mode) ? mode : 'generate';
    const normalizedLevel = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate';

    if (normalizedMode === 'generate') {
      if (!topic || !String(topic).trim()) {
        return res.status(400).json({ message: 'Topic is required for scenario generation' });
      }

      const fallbackGenerated = {
        source: 'fallback',
        mode: 'generate',
        title: `${topic} - Practical Scenario`,
        scenario: `You are working on a real-world ${topic} task. Design a clear and efficient approach suitable for ${normalizedLevel} level.`,
        tasks: [
          'Identify key constraints and assumptions',
          'Propose a step-by-step solution strategy',
          'Explain trade-offs and justify your decisions'
        ],
        rubric: [
          'Conceptual correctness (40%)',
          'Clarity and structure (30%)',
          'Practical feasibility (30%)'
        ]
      };

      if (!openaiClient) {
        return res.json(fallbackGenerated);
      }

      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `Return ONLY JSON object with keys:
title (string), scenario (string), tasks (array of 3 strings), rubric (array of 3 strings).
Keep it concise, practical, and interview/exam quality.`
          },
          {
            role: 'user',
            content: `Generate an exam-style practical scenario.
Topic: ${topic}
Level: ${normalizedLevel}
Context: ${promptContext || 'none'}`
          }
        ],
        temperature: 0.6,
        max_tokens: 550
      });

      const raw = completion.choices[0].message.content.trim();
      const parsed = JSON.parse(raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());
      return res.json({
        source: 'openai',
        mode: 'generate',
        title: parsed.title || fallbackGenerated.title,
        scenario: parsed.scenario || fallbackGenerated.scenario,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : fallbackGenerated.tasks,
        rubric: Array.isArray(parsed.rubric) ? parsed.rubric : fallbackGenerated.rubric
      });
    }

    if (!question || !studentAnswer) {
      return res.status(400).json({ message: 'Question and studentAnswer are required for evaluation' });
    }

    const fallbackEvaluation = {
      source: 'fallback',
      mode: 'evaluate',
      score: 70,
      strengths: [
        'Answer shows partial understanding of core concepts',
        'Some structure is present in explanation'
      ],
      improvements: [
        'Add clearer step-by-step logic',
        'Include practical example and edge-case handling'
      ],
      feedback: 'Good attempt. Improve clarity, completeness, and practical justification for a higher score.'
    };

    if (!openaiClient) {
      return res.json(fallbackEvaluation);
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are an exam evaluator.
Return ONLY JSON with keys:
score (number 0-100), strengths (array of 2-4 strings), improvements (array of 2-4 strings), feedback (string).`
        },
        {
          role: 'user',
          content: `Evaluate this answer.
Question: ${question}
Student Answer: ${studentAnswer}`
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());
    return res.json({
      source: 'openai',
      mode: 'evaluate',
      score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : fallbackEvaluation.score,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : fallbackEvaluation.strengths,
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : fallbackEvaluation.improvements,
      feedback: parsed.feedback || fallbackEvaluation.feedback
    });
  } catch (error) {
    console.error('AI exam lab error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/study-coach
 * @desc    Generate personalized student study plan
 * @access  Private
 */
router.post('/study-coach', async (req, res) => {
  try {
    const openaiClient = getOpenAIClient();
    const { topic = '', availableHours = 2, goal = 'Improve understanding' } = req.body;
    const hours = Math.min(Math.max(Number(availableHours) || 2, 1), 12);

    if (!topic || !String(topic).trim()) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const fallback = {
      source: 'fallback',
      title: `${topic} - Personalized Study Plan`,
      plan: [
        `Spend ${Math.max(1, Math.floor(hours * 0.4))}h on concept review and notes`,
        `Spend ${Math.max(1, Math.floor(hours * 0.4))}h on practice questions`,
        `Spend ${Math.max(1, Math.ceil(hours * 0.2))}h on recap and weak-area revision`
      ],
      checklist: [
        'Revise one key concept and write 5-point summary',
        'Solve at least 10 mixed questions',
        'Review mistakes and note correction strategy'
      ],
      revisionTips: [
        'Use spaced repetition: review after 1 day, 3 days, and 7 days',
        'Practice timed sets to improve speed and confidence',
        'Use active recall instead of only reading notes'
      ],
      examReadiness: [
        'Can explain core concepts without notes',
        'Can solve medium problems independently',
        'Can identify and fix common mistakes quickly'
      ]
    };

    if (!openaiClient) {
      return res.json(fallback);
    }

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Return ONLY JSON:
{
 "title":"string",
 "plan":["string"],
 "checklist":["string"],
 "revisionTips":["string"],
 "examReadiness":["string"]
}
Make this practical for students. Keep each item concise and actionable.`
        },
        {
          role: 'user',
          content: `Create a personalized study coach output.
Topic: ${topic}
Hours per day: ${hours}
Goal: ${goal}`
        }
      ],
      temperature: 0.55,
      max_tokens: 650
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim());
    return res.json({
      source: 'openai',
      title: parsed.title || fallback.title,
      plan: Array.isArray(parsed.plan) ? parsed.plan : fallback.plan,
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist : fallback.checklist,
      revisionTips: Array.isArray(parsed.revisionTips) ? parsed.revisionTips : fallback.revisionTips,
      examReadiness: Array.isArray(parsed.examReadiness) ? parsed.examReadiness : fallback.examReadiness
    });
  } catch (error) {
    console.error('AI study coach error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

async function buildAdminPlatformSnapshot() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    totalUsers,
    totalCourses,
    totalEnrollments,
    distinctStudents,
    usersByRole,
    coursesByStatus,
    newUsersWeek,
    ungradedSubmissions,
    totalAssignments,
    totalQuizzes
  ] = await Promise.all([
    User.countDocuments(),
    Course.countDocuments(),
    Enrollment.countDocuments(),
    Enrollment.distinct('studentId').then((ids) => ids.length),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Course.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    AssignmentSubmission.countDocuments({ score: null }),
    Assignment.countDocuments(),
    Quiz.countDocuments()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    totalUsers,
    totalCourses,
    totalEnrollments,
    activeStudents: distinctStudents,
    usersByRole: usersByRole.map((x) => ({ role: x._id || 'unknown', count: x.count })),
    coursesByStatus: coursesByStatus.map((x) => ({ status: x._id || 'unknown', count: x.count })),
    newUsersLast7Days: newUsersWeek,
    ungradedSubmissions,
    totalAssignments,
    totalQuizzes
  };
}

/**
 * @route   POST /api/ai/admin/platform-brief
 * @desc    AI executive brief from live Mongo stats (admin only)
 * @access  Admin
 */
router.post('/admin/platform-brief', authorize('admin'), async (req, res) => {
  try {
    const { focus = '' } = req.body;
    const snapshot = await buildAdminPlatformSnapshot();
    const openaiClient = getOpenAIClient();

    const fallback = {
      source: 'fallback',
      title: 'Platform snapshot',
      executiveSummary: `The LMS currently has ${snapshot.totalUsers} users, ${snapshot.totalCourses} courses, and ${snapshot.totalEnrollments} enrollments. About ${snapshot.activeStudents} distinct students are enrolled. Ungraded assignment submissions: ${snapshot.ungradedSubmissions}. New accounts in the last 7 days: ${snapshot.newUsersLast7Days}.`,
      priorities: [
        snapshot.ungradedSubmissions > 0
          ? 'Align with instructors on grading backlog and deadlines'
          : 'Grading backlog is clear — keep monitoring weekly',
        snapshot.newUsersLast7Days > 0
          ? 'Onboard new users with a short welcome checklist'
          : 'Consider campaigns or partnerships to grow signups',
        'Review role distribution and course publish pipeline in Analytics / Courses'
      ],
      watchlist: [
        'Watch for sudden spikes in pending submissions before exam windows',
        'Ensure archived vs published course ratio matches your governance policy'
      ],
      nextSteps: ['Open Analytics for trends', 'Open Users to verify roles', 'Spot-check high-enrollment courses']
    };

    if (!openaiClient) {
      return res.json({ ...fallback, snapshot });
    }

    const adminModel = resolveEnvValue('OPENAI_ADMIN_MODEL') || 'gpt-4o-mini';
    let completion;
    try {
      completion = await openaiClient.chat.completions.create({
      model: adminModel,
      messages: [
        {
          role: 'system',
          content: `You are an LMS platform administrator advisor.
Return ONLY JSON with keys:
title (string),
executiveSummary (string, 3-5 sentences, plain text),
priorities (array of 3-5 short actionable strings for the admin),
watchlist (array of 2-4 potential risks or things to monitor),
nextSteps (array of 3-5 concrete admin tasks).
Use only the facts from the snapshot JSON; do not invent numbers. If an optional admin focus is provided, reflect it in priorities or nextSteps.`
        },
        {
          role: 'user',
          content: `Snapshot JSON:\n${JSON.stringify(snapshot)}\n\nAdmin focus (optional):\n${String(focus || '').trim() || '(none)'}`
        }
      ],
      temperature: 0.35,
      max_tokens: 900,
      response_format: { type: 'json_object' }
    });
    } catch (apiErr) {
      console.warn('AI admin platform-brief OpenAI call failed:', apiErr.message);
      return res.json({
        ...fallback,
        snapshot,
        source: 'fallback',
        note: apiErr.message || 'OpenAI request failed'
      });
    }

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const parsed = parseAssistantJson(raw);
    if (!parsed) {
      console.warn('AI admin platform-brief: non-JSON model output');
      return res.json({
        ...fallback,
        snapshot,
        source: 'fallback',
        note: 'Could not parse AI response; showing default brief.'
      });
    }
    return res.json({
      source: 'openai',
      title: parsed.title || fallback.title,
      executiveSummary: parsed.executiveSummary || fallback.executiveSummary,
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities : fallback.priorities,
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : fallback.watchlist,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : fallback.nextSteps,
      snapshot
    });
  } catch (error) {
    console.error('AI admin platform brief error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/ai/admin/announcement-draft
 * @desc    Draft admin announcements (maintenance, policy, events)
 * @access  Admin
 */
router.post('/admin/announcement-draft', authorize('admin'), async (req, res) => {
  try {
    const { topic = '', audience = 'all_users', tone = 'professional', context = '', channel = 'in-app' } = req.body;

    if (!String(topic).trim()) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const openaiClient = getOpenAIClient();
    const t = topic.trim();
    const fallback = {
      source: 'fallback',
      title: `Notice: ${t.slice(0, 72)}${t.length > 72 ? '…' : ''}`,
      body: `We are sharing an important update: ${t}.\n\nPlease read this carefully and follow any instructions from your instructors or administrators. If you have questions, use the usual support channel.\n\nThank you,\nLMS Administration`,
      shortBlurb: t.length > 150 ? `${t.slice(0, 147)}…` : t
    };

    if (!openaiClient) {
      return res.json(fallback);
    }

    const adminModel = resolveEnvValue('OPENAI_ADMIN_MODEL') || 'gpt-4o-mini';
    let completion;
    try {
      completion = await openaiClient.chat.completions.create({
      model: adminModel,
      messages: [
        {
          role: 'system',
          content: `You draft concise LMS administrator announcements.
Return ONLY JSON with keys:
title (string, max ~90 chars),
body (string, 2-4 short paragraphs, plain text, suitable for email or in-app notice),
shortBlurb (string, one line, max ~180 chars for SMS/push preview).
Tone: professional | friendly | urgent. Audience: all_users | students | teachers.
Do not use markdown code fences inside JSON string values.`
        },
        {
          role: 'user',
          content: `Topic: ${t}\nAudience: ${audience}\nTone: ${tone}\nChannel: ${channel}\nExtra context:\n${String(context || '').trim() || '(none)'}`
        }
      ],
      temperature: 0.45,
      max_tokens: 700,
      response_format: { type: 'json_object' }
    });
    } catch (apiErr) {
      console.warn('AI admin announcement-draft OpenAI call failed:', apiErr.message);
      return res.json({
        ...fallback,
        source: 'fallback',
        note: apiErr.message || 'OpenAI request failed'
      });
    }

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const parsed = parseAssistantJson(raw);
    if (!parsed) {
      console.warn('AI admin announcement-draft: non-JSON model output, raw length', raw.length);
      return res.json({
        ...fallback,
        source: 'fallback',
        note: 'Could not parse AI response; showing template draft.'
      });
    }
    return res.json({
      source: 'openai',
      title: parsed.title || fallback.title,
      body: parsed.body || fallback.body,
      shortBlurb: parsed.shortBlurb || fallback.shortBlurb
    });
  } catch (error) {
    console.error('AI admin announcement draft error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

