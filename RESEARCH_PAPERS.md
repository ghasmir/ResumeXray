# Literature Review: ATS Resume Checker with Live AI Fix Agent

**Compiled: March 2026**
**Coverage: 2024-2026 academic papers, technical reports, and industry articles**

---

## Topic 1: ATS Parsing & Resume Ranking Algorithms

### 1.1 Resume2Vec: Transforming Applicant Tracking Systems with Intelligent Resume Embeddings for Precise Candidate Matching
- **Authors:** (Multiple authors, MDPI Electronics)
- **Venue:** MDPI Electronics, Vol. 14, Issue 4, Article 794
- **Year:** February 2025
- **URL:** https://www.mdpi.com/2079-9292/14/4/794
- **Key Findings:** Uses transformer-based deep learning models including encoders (BERT, RoBERTa, DistilBERT) and decoders (GPT, Gemini, Llama) to create embeddings for resumes and job descriptions. Cosine similarity is used for evaluation. Outperformed conventional ATS systems by 15.85% in nDCG and 15.94% in RBO scores. Demonstrates that semantic embeddings dramatically outperform keyword-matching approaches.
- **Relevance:** Core architecture reference for building embedding-based resume-to-JD matching in our ATS checker.

### 1.2 CareerBERT: Matching Resumes to ESCO Jobs in a Shared Embedding Space for Generic Job Recommendations
- **Authors:** Julian Rosenberger, Lukas Wolfrum, Sven Weinzierl, Mathias Kraus, Patrick Zschech
- **Venue:** Expert Systems with Applications, Vol. 275, Article 127043
- **Year:** 2025
- **URL:** https://www.sciencedirect.com/science/article/pii/S0957417425006657 | arXiv: https://arxiv.org/abs/2503.02056
- **Key Findings:** Fine-tuned Sentence-BERT (SBERT) Siamese network architecture using Multiple Negatives Ranking loss. Maps both resumes and ESCO job taxonomy entries into a shared high-dimensional embedding space. Achieved MRR@100 of 0.328, outperforming Word2Vec and Doc2Vec baselines. Code available on GitHub.
- **Relevance:** Demonstrates the Siamese SBERT architecture for resume-job matching; the ESCO taxonomy integration provides a standardized skill/occupation framework.

### 1.3 Automated Resume Parsing and Ranking using Natural Language Processing
- **Venue:** IEEE Conference Publication (IEEE Xplore)
- **Year:** 2024
- **URL:** https://ieeexplore.ieee.org/document/10574696/
- **Key Findings:** Comprehensive review of rule-based, ML, and deep-learning approaches to resume parsing. Covers named entity recognition (NER) for extracting skills, experience, education. Examines section detection via transformer-based models.
- **Relevance:** Provides the foundational taxonomy of parsing techniques our system can use for resume section detection.

### 1.4 A Novel Approach for Resume Ranking System Using Machine Learning
- **Venue:** Springer (ICISSC 2024 Conference Proceedings), Lecture Notes in Networks and Systems, Vol. 978-981-97-8355-7
- **Year:** Published February 2025
- **URL:** https://link.springer.com/chapter/10.1007/978-981-97-8355-7_23
- **Key Findings:** Compared Random Forest, KNN, SVM, Decision Tree, Logistic Regression, and Naive Bayes for resume ranking. Random Forest produced the most accurate results. Addresses challenges of algorithmic bias, data diversity, and customizable ranking rules.
- **Relevance:** Benchmark comparison of ML classifiers for resume ranking; useful for understanding which traditional ML approaches complement LLM-based systems.

### 1.5 Automated Resume Parsing: A Review of Techniques
- **Venue:** All Multidisciplinary Journal
- **Year:** April 2025
- **URL:** https://www.allmultidisciplinaryjournal.com/uploads/archives/20250407162326_MGE-2025-2-238.1.pdf
- **Key Findings:** Surveys rule-based methods (regex, dictionary-based section headers like Taleo), ML models, and deep learning techniques. Notes that modern parsers (Greenhouse, Lever) use ML for context-based section identification, while legacy systems (Taleo) rely on dictionary-based header matching.
- **Relevance:** Critical for understanding real-world ATS parser differences; informs our system's advice on formatting resumes for different ATS platforms.

### 1.6 NLP-Based Resume Analysis, Skill Extraction and Job Matching
- **Venue:** International Research Journal of Engineering and Technology (IRJET), Vol. 12, Issue 4
- **Year:** April 2025
- **URL:** https://www.irjet.net/archives/V12/i4/IRJET-V12I4268.pdf
- **Key Findings:** Uses SpaCy NER, TF-IDF vectorization, and cosine similarity for skill extraction and matching. S-BERT embeddings (384-dimensional) achieved coherence scores of 0.426 vs. standard BERT's 0.194 (2.2x improvement in semantic understanding).
- **Relevance:** Practical implementation reference for the NLP pipeline combining NER skill extraction with semantic similarity scoring.

### 1.7 Smart ATS Resume Builder Using SpaCy and Cosine Similarity
- **Venue:** IJRTI (International Journal for Research Trends and Innovation), Vol. 10
- **Year:** October 2025
- **URL:** https://www.ijrti.org/papers/IJRTI2510146.pdf
- **Key Findings:** Uses SpaCy for tokenization, lemmatization, and NER to extract skills, experience, and education. Combines TF-IDF vectorization with cosine similarity for ATS compatibility scoring. Demonstrates end-to-end system from parsing to score generation.
- **Relevance:** Direct architectural reference for building an ATS score calculator.

### 1.8 Transversal Skill Classification and Keyword Extraction from Job Advertisements
- **Venue:** MDPI Information, Vol. 16, Issue 3, Article 167
- **Year:** 2025
- **URL:** https://www.mdpi.com/2078-2489/16/3/167
- **Key Findings:** Combines TF-IDF term importance metrics with neural network classification for extracting transversal (transferable) skills from job ads. Addresses the challenge of matching skills that may be described differently across job postings and resumes.
- **Relevance:** Informs our keyword extraction strategy, especially for identifying transferable skills that candidates may phrase differently.

---

## Topic 2: Resume Optimization with LLMs/AI

### 2.1 AI Hiring with LLMs: A Context-Aware and Explainable Multi-Agent Framework for Resume Screening
- **Authors:** Frank P.-W. Lo, Jianing Qiu, Zeyu Wang, Haibao Yu, Yeming Chen, Gao Zhang, Benny Lo
- **Venue:** CVPR 2025 Workshop (MEIS); arXiv:2504.02870
- **Year:** April 2025
- **URL:** https://arxiv.org/abs/2504.02870
- **Key Findings:** Four-agent architecture: Resume Extractor, Evaluator, Summarizer, Score Formatter. Integrates RAG within the evaluator for incorporating industry expertise, certifications, university rankings, and company-specific criteria. HR professionals can upload job requirement documents to adapt screening criteria in real-time. Outperforms single-LLM approaches in scalability and adaptability.
- **Relevance:** Directly applicable multi-agent architecture for our ATS checker. The RAG-augmented evaluator pattern is ideal for our "fix agent" that needs domain knowledge about ATS best practices.

### 2.2 Application of LLM Agents in Recruitment: A Novel Framework for Resume Screening
- **Authors:** Chengguang Gan, Qinghao Zhang, Tatsunori Mori
- **Venue:** Journal of Information Processing (accepted); arXiv:2401.08315
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2401.08315
- **Key Findings:** LLM-based agent system for hiring that handles summarization, grading, and automated decision-making. 11x faster than manual screening. Fine-tuned models achieved 87.73% F1 score on resume sentence classification. Surpassed GPT-3.5 baseline in summarization and grading.
- **Relevance:** Validates the LLM agent approach for resume processing; the sentence-level classification approach could power our bullet-point analysis feature.

### 2.3 Human and LLM-Based Resume Matching: An Observational Study
- **Authors:** Swanand Vaishampayan, Hunter Leary, Yoseph Berhanu Alebachew, Louis Hickman, Brent Stevenor, Weston Beck, Chris Brown
- **Venue:** Findings of NAACL 2025, pages 4823-4838
- **Year:** April 2025
- **URL:** https://aclanthology.org/2025.findings-naacl.270/
- **Key Findings:** Analyzed 736 resumes across diverse job openings. LLM scores correlate only minorly with human scores (not interchangeable). Chain-of-Thought prompting improves rating quality. LLM scores do not show larger group differences (bias) than humans. Provides implications for fair NLP-based resume matching.
- **Relevance:** Important calibration data -- our system should not present AI scores as equivalent to human judgment. CoT prompting should be used for evaluation.

### 2.4 Reading Between the Lines: Classifying Resume Seniority with Large Language Models
- **Authors:** Matan Cohen, Shira Shani, Eden Menahem, Yehudit Aperstein, Alexander Apartsin
- **Venue:** arXiv:2509.09229
- **Year:** September 2025
- **URL:** https://arxiv.org/abs/2509.09229
- **Key Findings:** Investigates fine-tuned BERT architectures for automating seniority classification from resumes. Addresses challenges of overstated experience and ambiguous self-presentation. LLMs can detect seniority signals beyond explicit years-of-experience counts.
- **Relevance:** Our fix agent could use seniority detection to calibrate tone and content recommendations (e.g., a junior candidate should not write like a VP).

### 2.5 Zero-Shot Resume-Job Matching with LLMs via Structured Prompting and Semantic Embeddings
- **Authors:** (MDPI Electronics)
- **Venue:** MDPI Electronics, Vol. 14, Issue 24, Article 4960
- **Year:** December 2025
- **URL:** https://www.mdpi.com/2079-9292/14/24/4960
- **Key Findings:** Uses Chain-of-Thought structured prompts with Mistral (open-mistral-7b) to convert unstructured resumes/JDs into structured segments. Then uses nomic-embed-text-v1-5 and google-embedding-gemma-300m for sentence embeddings. Achieved up to 87% matching accuracy for specific occupations. Fully zero-shot -- no fine-tuning required.
- **Relevance:** Demonstrates that zero-shot approaches with structured prompting can achieve strong results, reducing the need for training data in our system.

### 2.6 Enhancing Job Recommendations with LLM-Based Resume Completion: A Behavior-Denoised Alignment Approach
- **Venue:** ScienceDirect (Information Sciences)
- **Year:** 2025
- **URL:** https://www.sciencedirect.com/science/article/abs/pii/S030645732500202X
- **Key Findings:** Proposes "Denoised Direct Preference Optimization" (Denoised DPO) to disentangle genuine user preferences from noisy behavioral data. Uses LLM-based resume completion to fill gaps. Validated with online A/B tests on a major Chinese recruitment platform. Introduces Thurstonian-style preference modeling.
- **Relevance:** The resume completion concept is directly applicable -- our fix agent could suggest adding missing sections or expanding thin areas.

### 2.7 Deep Learning-Based Intelligent Resume-Position Matching System
- **Venue:** ACM Proceedings, International Symposium on Machine Learning and Social Computing
- **Year:** 2025
- **URL:** https://dl.acm.org/doi/full/10.1145/3778450.3778452
- **Key Findings:** BERT model for semantic understanding in massive recruitment data. Demonstrates that contextual embeddings capture nuanced relationships between achievements, skills, and experience beyond surface keyword matches.
- **Relevance:** Validates BERT-based semantic matching as the state-of-the-art for resume-position alignment.

### 2.8 SkillSync: An Explainable AI Framework for Resume Evaluation, Skill Gap Analysis, and Career Alignment
- **Venue:** IJERT (International Journal of Engineering Research & Technology)
- **Year:** 2025
- **URL:** https://www.ijert.org/skillsync-an-explainable-ai-framework-for-resume-evaluation-skill-gap-analysis-and-career-alignment-ijertconv14is010027
- **Key Findings:** Uses semantic matching with Sentence-BERT for explainable ATS scoring. Provides skill gap analysis identifying missing/underdeveloped skills. Emphasizes explainability in AI-driven resume evaluation.
- **Relevance:** The explainability aspect is key -- our fix agent should explain WHY a score is low and WHAT skills are missing, not just provide a number.

### 2.9 How I Built an LLM-Powered Resume Optimizer to Beat ATS Filters
- **Author:** Leonardo Gonzalez
- **Venue:** Medium (technical blog post)
- **Year:** May 2025
- **URL:** https://medium.com/@leofgonzalez/how-i-built-an-llm-powered-resume-optimizer-to-beat-ats-filters-8ace36d5d32c
- **Key Findings:** Architecture: Streamlit frontend, PostgreSQL backend, llama-3.3-70b-versatile via Groq API. Uses finite state machine for workflow control through four phases. Pydantic models for structured resume output schemas. Key insight: single-column layouts, standard section headers, and clean keyword parsing are critical for ATS compatibility.
- **Relevance:** Practical implementation reference. The state-machine workflow pattern and structured output via Pydantic are directly applicable to our agent's iterative improvement flow.

---

## Topic 3: Algorithmic Bias in Hiring & ATS Systems

### 3.1 Gender, Race, and Intersectional Bias in Resume Screening via Language Model Retrieval
- **Authors:** Kyra Wilson, Aylin Caliskan
- **Venue:** AAAI/ACM Conference on AI, Ethics, and Society (AIES 2024)
- **Year:** 2024
- **URL:** https://arxiv.org/abs/2407.20371 | https://ojs.aaai.org/index.php/AIES/article/view/31748
- **Key Findings:** Examined LLMs across 9 occupations with 500+ resumes. White-associated names favored in 85.1% of cases. Female-associated names favored in only 11.1% of cases. Black male candidates disadvantaged in up to 100% of cases. Document length variations and name frequency in training corpora contribute to bias. Intersectional identities compound disadvantage.
- **Relevance:** Critical ethical consideration -- our system must be designed to avoid perpetuating these biases. Name-blind scoring and bias auditing should be built in.

### 3.2 Evaluating Bias in LLMs for Job-Resume Matching: Gender, Race, and Education
- **Authors:** Hayate Iso, Pouya Pezeshkpour, Nikita Bhutani, Estevam Hruschka
- **Venue:** NAACL 2025 Industry Track, pages 672-683 (Albuquerque, NM)
- **Year:** 2025
- **URL:** https://aclanthology.org/2025.naacl-industry.55/ | arXiv: https://arxiv.org/abs/2503.19182
- **Key Findings:** Recent LLMs have reduced biases related to explicit attributes (gender, race), BUT implicit biases concerning educational background remain significant. Highlights need for ongoing evaluation and advanced bias mitigation strategies. Published by Megagon Labs.
- **Relevance:** Our system should be aware that educational institution bias persists even in modern LLMs. The fix agent should not inadvertently favor candidates from prestigious institutions.

### 3.3 Fairness in AI-Driven Recruitment: Challenges, Metrics, Methods, and Future Directions
- **Authors:** Dena F. Mujtaba, Nihar R. Mahapatra
- **Venue:** arXiv:2405.19699 (survey paper)
- **Year:** 2024 (v3 updated 2025)
- **URL:** https://arxiv.org/html/2405.19699v3
- **Key Findings:** Comprehensive survey defining 10 fairness metrics (demographic parity, counterfactual fairness, individual fairness, multi-sided fairness, etc.). Categorizes mitigation into pre-processing (reweighting, synthetic data), in-processing (fairness constraints during training), and post-processing (output adjustments). Reviews auditing approaches used in practice.
- **Relevance:** Definitive reference for implementing fairness checks in our system. We should implement at minimum demographic parity and counterfactual fairness testing.

### 3.4 Fairness and Bias in Algorithmic Hiring: A Multidisciplinary Survey
- **Venue:** ACM Transactions on Intelligent Systems and Technology (TIST)
- **Year:** 2024
- **URL:** https://dl.acm.org/doi/full/10.1145/3696457
- **Key Findings:** Multidisciplinary survey covering technical, legal, and organizational perspectives. Describes the main fairness measures and mitigation approaches. Presents datasets used in algorithmic hiring literature. Bridges CS, law, and HR research communities.
- **Relevance:** Comprehensive reference bridging technical implementation with legal compliance requirements.

### 3.5 Fair AI in Hiring: Experimental Evidence on How Biased Hiring Algorithms and Different Debiasing Methods Affect Quality and Diversity
- **Author:** Edwin Ip
- **Venue:** SAGE Journals (Organizational Behavior and Human Decision Processes)
- **Year:** 2025
- **URL:** https://journals.sagepub.com/doi/10.1177/23794607251353585
- **Key Findings:** Experimental study testing pre-processing (Reweighing), in-processing (Adversarial Debiasing), and post-processing (Reject Option) interventions. All debiasing approaches significantly increased female applicants without compromising quality. Provides empirical evidence that debiasing does NOT reduce hiring quality.
- **Relevance:** Evidence that our system can implement bias mitigation without sacrificing recommendation quality.

### 3.6 Reducing AI Bias in Recruitment and Selection: An Integrative Grounded Approach
- **Venue:** Taylor & Francis, International Journal of Human Resource Management
- **Year:** 2025
- **URL:** https://www.tandfonline.com/doi/full/10.1080/09585192.2025.2480617
- **Key Findings:** Grounded theory study interviewing 39 HR professionals and AI developers. Identifies practical bias sources and mitigation techniques from practitioner perspectives. Proposes sociotechnical framework combining algorithmic techniques, human oversight, regulatory frameworks, and stakeholder engagement.
- **Relevance:** Practitioner-informed perspective on bias mitigation; useful for designing our system's human-in-the-loop review features.

### 3.7 Bias in AI-Driven HRM Systems: Investigating Discrimination Risks in AI Recruitment Tools
- **Venue:** ScienceDirect (Computers in Human Behavior Reports)
- **Year:** 2025
- **URL:** https://www.sciencedirect.com/science/article/pii/S2590291125008113
- **Key Findings:** Treats gender, racial, and disability bias as interconnected manifestations of algorithmic discrimination sharing common roots in biased data and opaque model design. Highlights that 98.4% of Fortune 500 companies use AI in hiring.
- **Relevance:** Reinforces the need for intersectional bias testing and transparent scoring in our system.

### 3.8 EU AI Act and Hiring: Regulatory Framework
- **Key Sources:**
  - [Crowell & Moring: AI and HR in the EU -- 2026 Legal Overview](https://www.crowell.com/en/insights/client-alerts/artificial-intelligence-and-human-resources-in-the-eu-a-2026-legal-overview)
  - [Greenberg Traurig: AI in Recruitment -- EU and US Considerations](https://www.gtlaw.com/en/insights/2025/5/use-of-ai-in-recruitment-and-hiring-considerations-for-eu-and-us-companies)
  - [HeroHunt: Recruiting under the EU AI Act](https://www.herohunt.ai/blog/recruiting-under-the-eu-ai-act-impact-on-hiring/)
- **Year:** 2025-2026
- **Key Findings:**
  - Hiring AI tools classified as "high-risk" under EU AI Act Article 6
  - Emotion recognition in hiring banned since February 2, 2025
  - General-purpose AI (LLMs in recruiting) transparency rules effective August 2, 2025
  - Full high-risk compliance (documentation, human oversight, audits) enforceable August 2, 2026
  - Extraterritorial reach: covers US employers recruiting EU candidates
  - Banned: social scoring, predictive behavioral analysis, inferring protected traits from biometrics
  - Required: prior consultation with employee representatives per Article 26(7)
- **Relevance:** Our system must be designed with EU AI Act compliance in mind: transparency, explainability, human oversight, bias auditing, and documentation requirements.

---

## Topic 4: Real-Time AI Agents & Streaming

### 4.1 Beyond Request-Response: Architecting Real-Time Bidirectional Streaming Multi-Agent Systems
- **Author:** Hangfei Lin (Tech Lead, Google)
- **Venue:** Google Developers Blog / Google Agent Development Kit (ADK)
- **Year:** October 30, 2025
- **URL:** https://developers.googleblog.com/en/beyond-request-response-architecting-real-time-bidirectional-streaming-multi-agent-system/
- **Key Findings:**
  - Traditional request-response creates "perceived latency" and "disjointed tool integration"
  - ADK's LiveRequestQueue: asyncio-based queue for seamless multimodal input handling
  - Stateful, transferable sessions persist history and tool calls across agent handoffs
  - Event-driven callbacks (before_tool_callback, after_tool_callback) for lifecycle customization
  - AsyncGenerator-based streaming tools yield multiple results over time
  - Supports natural interruptibility ("barge-in") where agent stops to address new input
- **Relevance:** Architecture blueprint for our real-time fix agent. The streaming-native, event-driven, callback-based pattern is ideal for progressive resume improvement feedback.

### 4.2 System Architecture for Agentic Large Language Models
- **Author:** Tianjun Zhang
- **Venue:** UC Berkeley EECS Technical Report, UCB/EECS-2025-5
- **Year:** January 2025
- **URL:** https://www2.eecs.berkeley.edu/Pubs/TechRpts/2025/EECS-2025-5.pdf
- **Key Findings:** Addresses three critical aspects: (1) training LLMs to model and understand environment dynamics, (2) closed-loop decision-making frameworks for continual adaptation and action refinement, (3) strategies for ensuring execution safety. Provides foundational theory for agentic LLM system design.
- **Relevance:** Theoretical foundation for our agent architecture, especially the closed-loop decision-making for iterative resume improvement.

### 4.3 AFlow: Automating Agentic Workflow Generation
- **Authors:** (FoundationAgents team)
- **Venue:** ICLR 2025 (Oral Presentation)
- **Year:** 2025
- **URL:** https://arxiv.org/abs/2410.10762
- **Key Findings:** Reformulates workflow optimization as a search problem over code-represented workflows. Uses Monte Carlo Tree Search for iterative refinement. Introduces "operators" -- predefined, reusable agentic operations (e.g., Review & Revise). 5.7% average improvement over SOTA baselines. Smaller models can outperform GPT-4o at 4.55% of inference cost.
- **Relevance:** The "Review & Revise" operator pattern maps directly to our fix agent's iterative improvement loop. The MCTS-based workflow optimization could optimize our agent's improvement strategy.

### 4.4 SSE vs WebSockets for LLM Streaming: Architecture Patterns
- **Key Sources:**
  - [Procedure Tech: The Streaming Backbone of LLMs -- Why SSE Still Wins in 2026](https://procedure.tech/blogs/the-streaming-backbone-of-llms-why-server-sent-events-(sse)-still-wins-in-2025)
  - [Hivenet: Streaming for LLM Apps: SSE vs WebSockets](https://compute.hivenet.com/post/llm-streaming-sse-websockets)
  - [Render: Building Real-Time AI Chat Infrastructure](https://render.com/articles/real-time-ai-chat-websockets-infrastructure)
  - [FastAPI SSE for LLM Streaming](https://medium.com/@2nick2patel2/fastapi-server-sent-events-for-llm-streaming-smooth-tokens-low-latency-1b211c94cff5)
- **Year:** 2025-2026
- **Key Findings:**
  - SSE is the dominant protocol for LLM token streaming (stateless, lightweight, HTTP-native)
  - WebSockets better suited for collaborative editors and bidirectional communication
  - "Latency Theater": progressive SSE feedback creates perception of speed
  - SSE recommended for chat responses, summaries, code generation
  - WebSockets recommended for collaborative editing, voice streams, mid-generation client-to-server updates
  - Redis Streams can buffer and distribute LLM output to multiple clients
- **Relevance:** For our live fix agent: use SSE for streaming token-by-token resume improvements to the UI. Consider WebSocket only if the user needs to interrupt/redirect the agent mid-generation.

### 4.5 Building LangGraph: Designing an Agent Runtime from First Principles
- **Venue:** LangChain Blog
- **Year:** 2025
- **URL:** https://blog.langchain.com/building-langgraph/
- **Key Findings:** Key insight on perceived latency: showing useful information while the agent runs (progress bars, key actions, streaming tokens) dramatically improves user experience. LangGraph provides graph-based state machines for agent workflows with built-in streaming support.
- **Relevance:** LangGraph's state-machine approach aligns well with our multi-step resume improvement workflow. The progressive disclosure pattern should inform our UI design.

### 4.6 LLM Agents for Interactive Workflow Provenance
- **Venue:** arXiv:2509.13978
- **Year:** 2025
- **URL:** https://arxiv.org/html/2509.13978v2
- **Key Findings:** Modular, loosely coupled provenance agent system architecture. Facilitates live interaction between users and data during workflow execution. Leverages Model Context Protocol (MCP) for tool orchestration.
- **Relevance:** The provenance-tracking pattern could enable our system to show users exactly what the agent changed and why, supporting transparency and trust.

### 4.7 Rethinking Resume Scoring: How LLMs Are Transforming ATS for the AI Generation
- **Venue:** 47Billion Blog (industry analysis)
- **Year:** 2025
- **URL:** https://47billion.com/blog/rethinking-resume-scoring-how-llms-are-transforming-ats-for-the-ai-generation/
- **Key Findings:** Advocates hybrid architecture: LLMs for semantic understanding and contextual reasoning, traditional code for mathematical calculations and business logic. "The ATS of yesterday was a keyword filter. The ATS of tomorrow must be a contextual evaluator." Recommends that LLM-based ATS should understand what roles actually require and recognize potential in non-traditional candidates.
- **Relevance:** Validates our hybrid approach: LLM for semantic analysis + deterministic code for scoring formulas and formatting checks.

### 4.8 Reztune: AI Resume Tailoring Pipeline
- **Venue:** Reztune Blog (industry)
- **Year:** 2025-2026
- **URL:** https://www.reztune.com/blog/best-ai-resume-tailoring-2025/
- **Key Findings:** Production system using pipeline of 60+ specialized LLM prompts (not a single monolithic prompt). First deconstructs the job post to understand requirements, then analyzes career history, then strategically rewrites bullet points to mirror employer language and priorities. Goes beyond keyword matching to strategic content alignment.
- **Relevance:** The multi-prompt pipeline approach is more reliable than single-prompt generation. Our fix agent should use specialized prompts for each improvement type (keyword insertion, bullet rewriting, section reordering, etc.).

---

## Summary of Key Architectural Insights for ATS Resume Checker with Live AI Fix Agent

### Parsing & Analysis Layer
- Use transformer-based NER (fine-tuned BERT/SpaCy) for section detection and entity extraction
- Implement S-BERT embeddings for semantic similarity scoring (2.2x better than standard BERT)
- Combine TF-IDF keyword matching with semantic embeddings for hybrid scoring
- Account for ATS-specific parsing differences (Taleo dictionary-based vs. Greenhouse ML-based)

### Scoring & Matching Layer
- Adopt Resume2Vec/CareerBERT approach: encode both resume and JD into shared embedding space
- Use cosine similarity for matching with structured scoring rubrics
- Implement explainable scoring (SkillSync pattern) -- show WHY scores are low
- Zero-shot matching via structured CoT prompting achieves ~87% accuracy without fine-tuning

### AI Fix Agent Architecture
- Multi-agent pattern (Lo et al., 2025): separate agents for extraction, evaluation, suggestion, formatting
- RAG integration for domain-specific knowledge (industry expertise, ATS best practices)
- Iterative Review & Revise loop (AFlow operator pattern)
- State machine workflow control (Gonzalez, 2025) for multi-phase improvement
- Pipeline of specialized prompts (Reztune pattern) rather than monolithic prompt

### Streaming & Real-Time UX
- SSE for token-by-token streaming of improvements (dominant protocol for LLM apps)
- Progressive disclosure: show actions taken while agent processes
- Event-driven callbacks for lifecycle hooks (Google ADK pattern)
- Consider LangGraph for graph-based state machine with built-in streaming

### Bias & Fairness
- Implement name-blind scoring to avoid racial/gender bias (Wilson & Caliskan, 2024)
- Educational institution bias persists in modern LLMs (Iso et al., 2025)
- Pre-processing debiasing does NOT reduce quality (Ip, 2025)
- Design for EU AI Act compliance: transparency, explainability, human oversight, audit trails
- Target August 2026 deadline for full high-risk AI compliance

### Calibration
- LLM scores correlate only minorly with human judgment (Vaishampayan et al., 2025)
- CoT prompting significantly improves evaluation quality
- Hybrid LLM + deterministic code recommended for reliable scoring
