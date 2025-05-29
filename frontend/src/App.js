import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, doc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, setDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { ArrowDownUp, Edit3, Trash2, PlusCircle, Link as LinkIcon, Search, FileText, Brain, User, CalendarDays, CheckCircle, XCircle, Clock, Briefcase, Building2, ExternalLink, Globe } from 'lucide-react';

// --- Firebase Configuration ---
// NOTE: __firebase_config and __app_id will be provided by the environment
// For local development, you might need to provide these directly if not injected.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : { 
  apiKey: "YOUR_FIREBASE_API_KEY", // Replace with your actual Firebase config
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-job-tracker-app';

// --- Initialize Firebase ---
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// --- Helper Functions ---
const formatDate = (date) => {
  if (!date) return 'N/A';
  if (date instanceof Timestamp) {
    return date.toDate().toLocaleDateString();
  }
  if (typeof date === 'string') {
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate)) {
      return parsedDate.toLocaleDateString();
    }
  }
  return 'Invalid Date';
};

const JobStatus = {
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  OFFER_RECEIVED: 'Offer Received',
  REJECTED: 'Rejected',
  WAITING_REFERRAL: 'Waiting (Referral)',
  SAVED: 'Saved (Not Applied)',
  WITHDRAWN: 'Withdrawn',
};

const statusColors = {
  [JobStatus.APPLIED]: 'bg-blue-500',
  [JobStatus.INTERVIEWING]: 'bg-yellow-500',
  [JobStatus.OFFER_RECEIVED]: 'bg-green-500',
  [JobStatus.REJECTED]: 'bg-red-500',
  [JobStatus.WAITING_REFERRAL]: 'bg-purple-500',
  [JobStatus.SAVED]: 'bg-gray-500',
  [JobStatus.WITHDRAWN]: 'bg-pink-500',
};

const App = () => {
  // --- State Variables ---
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [currentJob, setCurrentJob] = useState(null); 

  const [showExtractionModal, setShowExtractionModal] = useState(false);
  const [jobDescriptionText, setJobDescriptionText] = useState('');
  const [jobPostUrl, setJobPostUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'dateApplied', direction: 'descending' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [jobToDelete, setJobToDelete] = useState(null);

  // --- Firebase Authentication ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        try {
          // For local development, __initial_auth_token might not be defined.
          // You'd typically rely on anonymous sign-in or other Firebase auth methods locally.
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            console.log("Attempting anonymous sign-in for local development or unauthenticated environment.");
            await signInAnonymously(auth);
          }
        } catch (e) {
          console.error("Error signing in: ", e);
          setError("Authentication failed. Please try again later.");
        }
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Firestore Data Fetching ---
  useEffect(() => {
    if (!isAuthReady || !userId) {
      setIsLoading(false); 
      return;
    }

    setIsLoading(true);
    // Construct the path using the appId and userId
    const jobCollectionPath = `artifacts/${appId}/users/${userId}/jobApplications`;
    console.log(`Fetching jobs from: ${jobCollectionPath}`); // For debugging
    const q = query(collection(db, jobCollectionPath));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const jobsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        dateApplied: doc.data().dateApplied instanceof Timestamp ? doc.data().dateApplied : (doc.data().dateApplied ? Timestamp.fromDate(new Date(doc.data().dateApplied)) : null),
        lastChecked: doc.data().lastChecked instanceof Timestamp ? doc.data().lastChecked : (doc.data().lastChecked ? Timestamp.fromDate(new Date(doc.data().lastChecked)) : null),
      }));
      setJobs(jobsData);
      setIsLoading(false);
      setError(null);
    }, (err) => {
      console.error("Error fetching jobs: ", err);
      setError(`Failed to load job applications from ${jobCollectionPath}. Please check your connection and Firebase rules. Error: ${err.message}`);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthReady, userId]); // Removed appId from dependencies as it's constant after init

  // --- Job Form Handling ---
  const handleOpenForm = (job = null) => {
    setCurrentJob(job);
    setShowForm(true);
    setExtractionError(''); 
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setCurrentJob(null);
    setJobDescriptionText(''); 
    setJobPostUrl(''); 
  };

  const handleSaveJob = async (jobData) => {
    if (!userId) {
      setError("User not authenticated. Cannot save job.");
      return;
    }
    const jobCollectionPath = `artifacts/${appId}/users/${userId}/jobApplications`;
    
    const processedData = {
      ...jobData,
      dateApplied: jobData.dateApplied ? Timestamp.fromDate(new Date(jobData.dateApplied)) : serverTimestamp(),
      lastChecked: jobData.lastChecked ? Timestamp.fromDate(new Date(jobData.lastChecked)) : serverTimestamp(),
      userId: userId, // Ensure userId is part of the document
      updatedAt: serverTimestamp()
    };
    // Only set createdAt for new jobs, preserve it for existing ones
    if (!currentJob?.id) { 
        processedData.createdAt = serverTimestamp();
    } else {
        // If editing, ensure createdAt is not overwritten if it exists, or set if missing from old data
        processedData.createdAt = currentJob.createdAt || serverTimestamp(); 
    }


    try {
      if (currentJob && currentJob.id) { 
        const jobRef = doc(db, jobCollectionPath, currentJob.id);
        await updateDoc(jobRef, processedData);
      } else { 
        await addDoc(collection(db, jobCollectionPath), processedData);
      }
      handleCloseForm();
    } catch (e) {
      console.error("Error saving job: ", e);
      setError(`Failed to save job. Error: ${e.message}`);
    }
  };

  const confirmDeleteJob = (jobId) => {
    setJobToDelete(jobId);
    setShowDeleteConfirm(true);
  };

  const handleDeleteJob = async () => {
    if (!userId || !jobToDelete) {
      setError("User not authenticated or no job selected for deletion.");
      setShowDeleteConfirm(false);
      return;
    }
    const jobCollectionPath = `artifacts/${appId}/users/${userId}/jobApplications`;
    try {
      const jobDocRef = doc(db, jobCollectionPath, jobToDelete);
      await deleteDoc(jobDocRef);
      setShowDeleteConfirm(false);
      setJobToDelete(null);
    } catch (e) {
      console.error("Error deleting job: ", e);
      setError(`Failed to delete job. Error: ${e.message}`);
      setShowDeleteConfirm(false);
    }
  };

  // --- Job Description Extraction ---
  const handleExtractDetails = async () => {
    setIsExtracting(true);
    setExtractionError('');
    let textToProcess = '';

    // Determine backend URL from environment variable, with a fallback for local dev
    const backendBaseUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001'; 
    // (Assuming your local backend runs on port 3001. Adjust if different.)

    if (jobPostUrl.trim()) {
        try {
            console.log(`Fetching from URL via proxy: ${backendBaseUrl}/proxy?url=${jobPostUrl}`);
            const response = await fetch(`${backendBaseUrl}/proxy?url=${encodeURIComponent(jobPostUrl)}`);
            
            if (!response.ok) {
                let errorDetails = response.statusText;
                try {
                    const errorData = await response.json(); // Try to get more specific error from backend
                    errorDetails = errorData.details || errorData.error || response.statusText;
                } catch (e) { /* Response might not be JSON */ }
                throw new Error(`Failed to fetch URL via proxy: ${errorDetails} (Status: ${response.status})`);
            }
            const htmlContent = await response.text();
            const parser = new DOMParser();
            const docHtml = parser.parseFromString(htmlContent, 'text/html');
            
            docHtml.querySelectorAll('script, style, nav, footer, header, aside, .sidebar, #sidebar, link[rel="stylesheet"]').forEach(el => el.remove());
            
            let mainContentElement = docHtml.querySelector('main, article, .main-content, #main, [role="main"], .job-description, #job-details');
            textToProcess = mainContentElement ? mainContentElement.innerText : docHtml.body.innerText; // Use innerText for cleaner text

            if (!textToProcess || textToProcess.trim().length < 50) { 
                 console.warn("Extracted text from URL is very short or empty, falling back to full body text.");
                 textToProcess = docHtml.body.innerText; 
            }

            textToProcess = textToProcess.replace(/\s\s+/g, ' ').trim(); 

            if (!textToProcess.trim()) {
                throw new Error("Could not extract meaningful text content from the URL after parsing.");
            }
        } catch (e) {
            console.error("Error fetching or parsing URL:", e);
            setExtractionError(`Error processing URL: ${e.message}. Try pasting text or check the URL/proxy.`);
            setIsExtracting(false);
            return;
        }
    } else if (jobDescriptionText.trim()) {
        textToProcess = jobDescriptionText.trim();
    } else {
        setExtractionError("Please provide a Job Posting URL or paste the Job Description text.");
        setIsExtracting(false);
        return;
    }

    if (textToProcess.length > 28000) { // Keep a margin for prompt and JSON structure
        console.warn("Text to process is very long, truncating to 28000 characters for AI.");
        textToProcess = textToProcess.substring(0, 28000);
    }

    const prompt = `From the following job posting content, extract these details: company name, job title/role, primary location (city, state if available, or "Remote"), and a concise 2-3 sentence summary of key responsibilities or technologies.
Provide the output as a valid JSON object with keys: "companyName", "role", "location", and "summary".
If a detail is not found, use an empty string "" or null for its value.
Job Posting Content: """${textToProcess}"""`;
    
    let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = {
      contents: chatHistory,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            "companyName": { "type": "STRING", "description": "The name of the company." },
            "role": { "type": "STRING", "description": "The job title or role." },
            "location": { "type": "STRING", "nullable": true, "description": "The primary location of the job (e.g., City, ST or Remote)." },
            "summary": { "type": "STRING", "description": "A brief summary of the job (2-3 sentences)." }
          },
          required: ["companyName", "role"] // Location and summary can be optional if not found
        }
      }
    };
    const apiKey = ""; // Handled by environment
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
      const aiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!aiResponse.ok) {
        const errorData = await aiResponse.json();
        console.error("Gemini API Error:", errorData);
        throw new Error(`AI API request failed: ${errorData?.error?.message || aiResponse.statusText} (Status: ${aiResponse.status})`);
      }
      const result = await aiResponse.json();

      if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
        const extractedJsonString = result.candidates[0].content.parts[0].text;
        let extractedData;
        try {
            extractedData = JSON.parse(extractedJsonString);
        } catch (parseError) {
            console.error("Error parsing JSON from AI:", parseError, "Raw string:", extractedJsonString);
            throw new Error("AI returned invalid JSON. Please try again or check the extracted text if it was from a URL.");
        }
        
        const newJobData = {
          companyName: extractedData.companyName || '',
          role: extractedData.role || '',
          location: extractedData.location || '',
          notes: extractedData.summary || '',
          dateApplied: new Date().toISOString().split('T')[0], 
          status: JobStatus.SAVED,
          link: jobPostUrl.trim() || '', 
          platformPosted: '',
          referralOptions: '',
          personPosted: '',
        };
        setCurrentJob(newJobData); 
        setShowExtractionModal(false); 
        setShowForm(true); 
        setJobDescriptionText(''); 
        setJobPostUrl('');

      } else {
        console.error("Unexpected response structure from Gemini API:", result);
        setExtractionError("Could not extract details: AI response format was unexpected.");
      }
    } catch (e) {
      console.error("Error during AI extraction phase:", e);
      setExtractionError(`AI Extraction Error: ${e.message}.`);
    } finally {
      setIsExtracting(false);
    }
  };

  // --- Sorting and Filtering ---
  const sortedJobs = React.useMemo(() => {
    let sortableItems = [...jobs];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];

        if (valA instanceof Timestamp && valB instanceof Timestamp) {
          valA = valA.toMillis();
          valB = valB.toMillis();
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          valA = valA.toLowerCase(); 
          valB = valB.toLowerCase();
        }
        if (valA == null && valB != null) return sortConfig.direction === 'ascending' ? 1 : -1;
        if (valA != null && valB == null) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA == null && valB == null) return 0;

        if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [jobs, sortConfig]);

  const filteredJobs = React.useMemo(() => {
    if (!searchTerm) return sortedJobs;
    return sortedJobs.filter(job =>
      Object.values(job).some(value =>
        String(value).toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [sortedJobs, searchTerm]);
  
  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    } else if (sortConfig.key === key && sortConfig.direction === 'descending') {
        key = 'dateApplied'; 
        direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key === key) {
      return sortConfig.direction === 'ascending' ? '▲' : '▼';
    }
    return '';
  };


  // --- Render Logic ---
  if (!isAuthReady) {
    return <div className="flex justify-center items-center h-screen bg-slate-900 text-white"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sky-500"></div><span className="ml-4 text-xl">Initializing App...</span></div>;
  }
  if (!userId) { // This case might briefly appear if anonymous sign-in is pending
     return <div className="flex justify-center items-center h-screen bg-slate-900 text-white"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sky-500"></div><span className="ml-4 text-xl">Authenticating User...</span></div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-sky-400">Job Application Tracker</h1>
        {userId && <p className="text-slate-400 mt-2 text-xs">User ID: <span className="font-mono">{userId}</span></p>}
      </header>

      {error && <div className="mb-4 p-3 bg-red-600 border border-red-400 text-white rounded-md shadow-lg text-sm">{error}</div>}
      
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="relative w-full sm:max-w-xs">
          <input
            type="text"
            placeholder="Search jobs..."
            className="w-full p-3 pl-10 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-500" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
                onClick={() => { 
                    setExtractionError(''); 
                    setShowExtractionModal(true);
                }}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-150 ease-in-out transform hover:scale-105"
            >
                <Brain size={20} /> Add via AI Extraction
            </button>
            <button
                onClick={() => handleOpenForm()}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-150 ease-in-out transform hover:scale-105"
            >
                <PlusCircle size={20} /> Add New Job
            </button>
        </div>
      </div>

      {isLoading && (
         <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sky-500"></div>
            <span className="ml-4 text-xl text-slate-300">Loading applications...</span>
        </div>
      )}

      {!isLoading && filteredJobs.length === 0 && (
        <div className="text-center py-10 bg-slate-800 rounded-xl shadow-xl">
          <FileText size={48} className="mx-auto text-slate-500 mb-4" />
          <p className="text-xl text-slate-400">No job applications found.</p>
          <p className="text-slate-500 mt-1">Start by adding a new job or extracting details from a job posting.</p>
        </div>
      )}

      {!isLoading && filteredJobs.length > 0 && (
        <div className="overflow-x-auto bg-slate-800 shadow-2xl rounded-xl">
          <table className="w-full min-w-[700px] text-left"> {/* min-w to help with responsiveness */}
            <thead className="border-b border-slate-700 bg-slate-800/50 sticky top-0 z-10">
              <tr>
                {['Company', 'Role', 'Date Applied', 'Status', 'Platform', 'Link', 'Actions'].map(header => (
                  <th key={header} 
                      className="p-4 text-sm font-semibold text-sky-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/50 transition-colors"
                      onClick={() => {
                          const keyMap = { 'Company': 'companyName', 'Role': 'role', 'Date Applied': 'dateApplied', 'Status': 'status', 'Platform': 'platformPosted' };
                          if (keyMap[header]) requestSort(keyMap[header]);
                      }}
                  >
                    {header} {header !== 'Link' && header !== 'Actions' && getSortIndicator(
                        { 'Company': 'companyName', 'Role': 'role', 'Date Applied': 'dateApplied', 'Status': 'status', 'Platform': 'platformPosted' }[header]
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredJobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-700/30 transition-colors duration-150">
                  <td className="p-4 align-top">
                    <div className="font-medium text-slate-200">{job.companyName || 'N/A'}</div>
                    {job.location && <div className="text-xs text-slate-400">{job.location}</div>}
                  </td>
                  <td className="p-4 align-top max-w-xs">
                    <div className="font-medium text-slate-200 truncate" title={job.role}>{job.role || 'N/A'}</div>
                  </td>
                  <td className="p-4 align-top text-slate-300">{formatDate(job.dateApplied)}</td>
                  <td className="p-4 align-top">
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full text-white ${statusColors[job.status] || 'bg-gray-600'}`}>
                      {job.status || 'N/A'}
                    </span>
                  </td>
                  <td className="p-4 align-top text-slate-300">{job.platformPosted || 'N/A'}</td>
                  <td className="p-4 align-top">
                    {job.link ? (
                      <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1">
                        View <ExternalLink size={14} />
                      </a>
                    ) : <span className="text-slate-500">N/A</span>}
                  </td>
                  <td className="p-4 align-top">
                    <div className="flex gap-2">
                      <button onClick={() => handleOpenForm(job)} className="p-2 text-yellow-400 hover:text-yellow-300 transition-colors" title="Edit Job">
                        <Edit3 size={18} />
                      </button>
                      <button onClick={() => confirmDeleteJob(job.id)} className="p-2 text-red-500 hover:text-red-400 transition-colors" title="Delete Job">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <JobForm
          job={currentJob}
          onSave={handleSaveJob}
          onClose={handleCloseForm}
        />
      )}

      {showExtractionModal && (
        <ExtractionModal
            jobDescriptionText={jobDescriptionText}
            setJobDescriptionText={setJobDescriptionText}
            jobPostUrl={jobPostUrl}
            setJobPostUrl={setJobPostUrl}
            onExtract={handleExtractDetails}
            onClose={() => { 
                setShowExtractionModal(false); 
                setExtractionError(''); 
                setJobDescriptionText('');
                setJobPostUrl('');
            }}
            isExtracting={isExtracting}
            extractionError={extractionError}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[70] backdrop-blur-sm"> {/* Increased z-index */}
          <div className="bg-slate-800 p-6 md:p-8 rounded-xl shadow-2xl w-full max-w-md">
            <h3 className="text-xl font-semibold text-sky-400 mb-4">Confirm Deletion</h3>
            <p className="text-slate-300 mb-6">Are you sure you want to delete this job application? This action cannot be undone.</p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="py-2 px-4 bg-slate-600 hover:bg-slate-500 text-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteJob}
                className="py-2 px-4 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Job Form Component ---
const JobForm = ({ job, onSave, onClose }) => {
  const getInitialFormData = useCallback(() => {
    const defaults = {
      companyName: '', role: '',
      dateApplied: new Date().toISOString().split('T')[0],
      status: JobStatus.APPLIED,
      lastChecked: new Date().toISOString().split('T')[0],
      platformPosted: '', referralOptions: '', link: '', personPosted: '', location: '', notes: '',
    };

    if (job) {
      return {
        ...defaults, 
        ...job,      
        dateApplied: job.dateApplied
          ? (job.dateApplied instanceof Timestamp ? job.dateApplied.toDate().toISOString().split('T')[0] : new Date(job.dateApplied).toISOString().split('T')[0])
          : defaults.dateApplied,
        lastChecked: job.lastChecked
          ? (job.lastChecked instanceof Timestamp ? job.lastChecked.toDate().toISOString().split('T')[0] : new Date(job.lastChecked).toISOString().split('T')[0])
          : defaults.lastChecked,
      };
    }
    return defaults;
  }, [job]); 

  const [formData, setFormData] = useState(getInitialFormData());
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setFormData(getInitialFormData());
  }, [job, getInitialFormData]);


  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(''); 
    if (!formData.companyName || !formData.role) {
        setFormError("Company Name and Role are required.");
        return;
    }
    onSave(formData);
  };

  const inputClass = "w-full p-3 bg-slate-700 border border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors text-slate-100 placeholder-slate-400";
  const labelClass = "block text-sm font-medium text-slate-300 mb-1";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[60] backdrop-blur-sm"> {/* Ensure form is above other elements but below delete confirm if needed */}
      <div className="bg-slate-800 p-6 md:p-8 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-semibold text-sky-400 mb-6">{job && job.id ? 'Edit Job Application' : (job ? 'Review Extracted Details' : 'Add New Job Application')}</h2>
        
        {formError && <div className="mb-4 p-3 bg-red-700 border border-red-500 text-white rounded-md text-sm">{formError}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="companyName" className={labelClass}><Building2 size={16} className="inline mr-2" />Company Name*</label>
              <input type="text" name="companyName" id="companyName" value={formData.companyName} onChange={handleChange} className={inputClass} placeholder="e.g., Google" required />
            </div>
            <div>
              <label htmlFor="role" className={labelClass}><Briefcase size={16} className="inline mr-2" />Role*</label>
              <input type="text" name="role" id="role" value={formData.role} onChange={handleChange} className={inputClass} placeholder="e.g., Software Engineer" required />
            </div>
          </div>
          
          <div>
              <label htmlFor="location" className={labelClass}><Globe size={16} className="inline mr-2" />Location</label> {/* Changed icon for consistency */}
              <input type="text" name="location" id="location" value={formData.location} onChange={handleChange} className={inputClass} placeholder="e.g., Mountain View, CA or Remote" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="dateApplied" className={labelClass}><CalendarDays size={16} className="inline mr-2" />Date Applied</label>
              <input type="date" name="dateApplied" id="dateApplied" value={formData.dateApplied} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label htmlFor="status" className={labelClass}><CheckCircle size={16} className="inline mr-2" />Status</label>
              <select name="status" id="status" value={formData.status} onChange={handleChange} className={inputClass}>
                {Object.values(JobStatus).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="platformPosted" className={labelClass}><Search size={16} className="inline mr-2" />Platform Posted</label>
              <input type="text" name="platformPosted" id="platformPosted" value={formData.platformPosted} onChange={handleChange} className={inputClass} placeholder="e.g., LinkedIn, Company Website" />
            </div>
             <div>
              <label htmlFor="lastChecked" className={labelClass}><Clock size={16} className="inline mr-2" />Last Checked</label>
              <input type="date" name="lastChecked" id="lastChecked" value={formData.lastChecked} onChange={handleChange} className={inputClass} />
            </div>
          </div>

          <div>
            <label htmlFor="link" className={labelClass}><LinkIcon size={16} className="inline mr-2" />Job Posting Link</label>
            <input type="url" name="link" id="link" value={formData.link} onChange={handleChange} className={inputClass} placeholder="https://example.com/job/123" />
          </div>
          
          <div>
            <label htmlFor="referralOptions" className={labelClass}><User size={16} className="inline mr-2" />Referral / Contact</label>
            <input type="text" name="referralOptions" id="referralOptions" value={formData.referralOptions} onChange={handleChange} className={inputClass} placeholder="e.g., Referred by John Doe, Contacted Recruiter Name" />
          </div>
           <div>
            <label htmlFor="personPosted" className={labelClass}><User size={16} className="inline mr-2" />Person Posted (Link)</label>
            <input type="url" name="personPosted" id="personPosted" value={formData.personPosted} onChange={handleChange} className={inputClass} placeholder="e.g., LinkedIn profile of recruiter" />
          </div>

          <div>
            <label htmlFor="notes" className={labelClass}><FileText size={16} className="inline mr-2" />Notes / Summary</label>
            <textarea name="notes" id="notes" value={formData.notes} onChange={handleChange} rows="4" className={inputClass} placeholder="Any additional notes, key responsibilities, or extracted summary..."></textarea>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="py-2 px-4 bg-slate-600 hover:bg-slate-500 text-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" className="py-2 px-6 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg transition-colors shadow-md">
              {job && job.id ? 'Save Changes' : 'Add Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Extraction Modal Component ---
const ExtractionModal = ({ 
    jobDescriptionText, setJobDescriptionText, 
    jobPostUrl, setJobPostUrl, 
    onExtract, onClose, 
    isExtracting, extractionError 
}) => {
    const labelClass = "block text-sm font-medium text-slate-300 mb-1";
    const inputClass = "w-full p-3 bg-slate-700 border border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors text-slate-100 placeholder-slate-400";
    const textareaClass = `${inputClass} min-h-[150px] max-h-[30vh]`; // Adjusted height

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[70] backdrop-blur-sm"> {/* Increased z-index */}
            <div className="bg-slate-800 p-6 md:p-8 rounded-xl shadow-2xl w-full max-w-2xl">
                <h2 className="text-2xl font-semibold text-sky-400 mb-2">Extract Job Details with AI</h2>
                <p className="text-slate-400 mb-6 text-sm">Provide a Job Posting URL (recommended for best results) OR paste the job description text directly.</p>
                
                {extractionError && <div className="mb-4 p-3 bg-red-600 border border-red-400 text-white rounded-md text-sm">{extractionError}</div>}

                <div className="space-y-4">
                    <div>
                        <label htmlFor="jobPostUrl" className={labelClass}><Globe size={16} className="inline mr-2" />Job Posting URL</label>
                        <input
                            type="url"
                            id="jobPostUrl"
                            name="jobPostUrl"
                            value={jobPostUrl}
                            onChange={(e) => setJobPostUrl(e.target.value)}
                            className={inputClass}
                            placeholder="https://www.linkedin.com/jobs/view/..."
                            disabled={isExtracting}
                        />
                    </div>
                    
                    <div className="text-center my-2 text-slate-400 text-sm font-semibold">OR</div>

                    <div>
                        <label htmlFor="jobDescriptionText" className={labelClass}><FileText size={16} className="inline mr-2" />Paste Job Description Text</label>
                        <textarea
                            id="jobDescriptionText"
                            name="jobDescriptionText"
                            value={jobDescriptionText}
                            onChange={(e) => setJobDescriptionText(e.target.value)}
                            className={textareaClass}
                            placeholder="Paste the full job description here if not using URL..."
                            disabled={isExtracting}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-4 mt-6">
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="py-2 px-4 bg-slate-600 hover:bg-slate-500 text-slate-100 rounded-lg transition-colors"
                        disabled={isExtracting}
                    >
                        Cancel
                    </button>
                    <button 
                        type="button" 
                        onClick={onExtract} 
                        className="py-2 px-6 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-lg transition-colors shadow-md flex items-center gap-2"
                        disabled={isExtracting || (!jobPostUrl.trim() && !jobDescriptionText.trim())}
                    >
                        {isExtracting ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                                Extracting...
                            </>
                        ) : (
                            <>
                                <Brain size={18} /> Extract Details
                            </>
                        )}
                    </button>
                </div>
                 <p className="text-xs text-slate-500 mt-4">
                    Note: Extracting from URL uses your configured backend proxy. If issues persist, ensure your backend is running and accessible. Pasting text is a reliable fallback.
                </p>
            </div>
        </div>
    );
};


export default App;
