/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp, 
  Timestamp,
  addDoc,
  getDocFromServer
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  Users, 
  Plus, 
  LogIn, 
  Coffee, 
  HelpCircle, 
  Eye, 
  RotateCcw, 
  Share2, 
  Clock, 
  CheckCircle2,
  ChevronLeft,
  Trash2,
  SkipForward
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

// Types & Enums for Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

type VotingType = 'fibonacci' | 'free';

interface Room {
  id: string;
  code: string;
  creatorId: string;
  revealed: boolean;
  votingType: VotingType;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

interface Vote {
  userId: string;
  userName: string;
  vote: string;
  votedAt: Timestamp;
}

const FIBONACCI_VALUES = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '?', '☕'];

// Local ID management
const getLocalUserId = () => {
  let id = localStorage.getItem('poker_uid');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('poker_uid', id);
  }
  return id;
};

export default function App() {
  const [userId] = useState(getLocalUserId());
  const [userName, setUserName] = useState<string>(localStorage.getItem('poker_user_name') || '');
  const [view, setView] = useState<'home' | 'create' | 'room'>('home');
  const [roomCode, setRoomCode] = useState('');
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mandatory Error Handler (Simplified for no-auth)
  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: { userId },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setError(`Erreur Firestore (${operationType}): ${errInfo.error}`);
    throw new Error(JSON.stringify(errInfo));
  };

  // Initialization
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          setError("La base de données est hors ligne.");
        }
      } finally {
        setLoading(false);
      }
    };
    testConnection();
  }, []);

  // Room listener
  useEffect(() => {
    if (!currentRoom?.id) return;

    const roomRef = doc(db, 'rooms', currentRoom.id);
    const unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Room;
        if (data.expiresAt.toDate() < new Date()) {
          setError("La salle a expiré.");
          setCurrentRoom(null);
          setView('home');
          return;
        }
        setCurrentRoom({ ...data, id: snapshot.id });
      } else {
        setCurrentRoom(null);
        setView('home');
        setError("La salle n'existe plus.");
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `rooms/${currentRoom.id}`));

    const votesRef = collection(db, 'rooms', currentRoom.id, 'votes');
    const unsubscribeVotes = onSnapshot(votesRef, (snapshot) => {
      const votesData = snapshot.docs.map(doc => doc.data() as Vote);
      setVotes(votesData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `rooms/${currentRoom.id}/votes`));

    return () => {
      unsubscribeRoom();
      unsubscribeVotes();
    };
  }, [currentRoom?.id]);

  // Actions
  const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

  const handleCreateRoom = async (type: VotingType) => {
    const trimmedName = userName.trim();
    if (!trimmedName) {
      setError("Veuillez renseigner votre nom.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const code = generateCode();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

      const roomData = {
        code,
        creatorId: userId,
        revealed: false,
        votingType: type,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt)
      };

      const docRef = await addDoc(collection(db, 'rooms'), roomData);
      setCurrentRoom({ ...roomData, id: docRef.id, createdAt: Timestamp.fromDate(now) } as Room);
      setView('room');
      localStorage.setItem('poker_user_name', trimmedName);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'rooms');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    const trimmedName = userName.trim();
    if (!trimmedName || !roomCode) {
      setError("Veuillez renseigner votre nom et le code de la salle.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const q = query(collection(db, 'rooms'), where('code', '==', roomCode));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError("Code de salle invalide.");
        return;
      }

      const roomDoc = querySnapshot.docs[0];
      const roomData = roomDoc.data() as Room;

      if (roomData.expiresAt.toDate() < new Date()) {
        setError("Cette salle a expiré.");
        return;
      }

      setCurrentRoom({ ...roomData, id: roomDoc.id });
      setView('room');
      localStorage.setItem('poker_user_name', trimmedName);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'rooms');
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (value: string) => {
    if (!currentRoom) return;
    const path = `rooms/${currentRoom.id}/votes/${userId}`;
    try {
      await setDoc(doc(db, 'rooms', currentRoom.id, 'votes', userId), {
        userId: userId,
        userName,
        vote: value,
        votedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleReveal = async () => {
    if (!currentRoom || currentRoom.creatorId !== userId) return;
    const path = `rooms/${currentRoom.id}`;
    try {
      await updateDoc(doc(db, 'rooms', currentRoom.id), {
        revealed: true
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleReset = async () => {
    if (!currentRoom || currentRoom.creatorId !== userId) return;
    try {
      await updateDoc(doc(db, 'rooms', currentRoom.id), {
        revealed: false
      });
      const votesRef = collection(db, 'rooms', currentRoom.id, 'votes');
      const votesSnapshot = await getDocs(votesRef);
      const deletePromises = votesSnapshot.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${currentRoom.id}`);
    }
  };

  const handleShare = () => {
    if (!currentRoom) return;
    const text = `Rejoins ma session de Planning Poker ! Code : ${currentRoom.code}\nLien : ${window.location.href}`;
    navigator.clipboard.writeText(text);
    alert("Copié dans le presse-papier ! Partage-le sur Teams.");
  };

  const myVote = useMemo(() => votes.find(v => v.userId === userId), [votes, userId]);

  if (loading && !currentRoom) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Users className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-indigo-900">Agile Poker</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Session info removed */}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between"
            >
              <p>{error}</p>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                <Plus className="rotate-45 w-5 h-5" />
              </button>
            </motion.div>
          )}

          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="grid md:grid-cols-2 gap-8 mt-12"
            >
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-4xl font-extrabold text-slate-900 leading-tight">
                    Chiffrez vos tâches <br />
                    <span className="text-indigo-600">en toute simplicité.</span>
                  </h2>
                  <p className="text-lg text-slate-600">
                    Une application de Planning Poker temps réel pour vos sessions Agile.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Votre nom</label>
                    <input 
                      type="text" 
                      value={userName}
                      onChange={(e) => {
                        setUserName(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Ex: Jean Dupont"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 pt-2">
                    <button 
                      onClick={() => {
                        if (!userName.trim()) {
                          setError("Veuillez renseigner votre nom pour continuer.");
                          return;
                        }
                        setError(null);
                        setView('create');
                      }}
                      className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-200"
                    >
                      <Plus className="w-5 h-5" />
                      Créer un salon
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 flex flex-col justify-center space-y-6">
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-slate-800">Rejoindre un salon</h3>
                  <p className="text-slate-500">Entrez le code à 6 chiffres partagé par votre équipe.</p>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Votre nom</label>
                    <input 
                      type="text" 
                      value={userName}
                      onChange={(e) => {
                        setUserName(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Ex: Jean Dupont"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                    />
                  </div>
                  <input 
                    type="text" 
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder="Code: 123456"
                    maxLength={6}
                    className="w-full text-center text-3xl font-mono tracking-[0.5em] py-4 rounded-2xl border-2 border-slate-100 bg-slate-50 focus:bg-white focus:border-indigo-500 transition-all outline-none"
                  />
                  <button 
                    onClick={handleJoinRoom}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-white font-bold py-4 px-6 rounded-2xl transition-all"
                  >
                    <LogIn className="w-5 h-5" />
                    Rejoindre la salle
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'create' && (
            <motion.div 
              key="create"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl mx-auto mt-12 space-y-8"
            >
              <button 
                onClick={() => setView('home')}
                className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-medium transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Retour
              </button>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 space-y-8">
                <h2 className="text-3xl font-bold text-slate-900">Paramètres du salon</h2>
                
                <div className="space-y-6">
                  {/* Name confirmation removed */}

                  <div className="space-y-4">
                    <p className="font-semibold text-slate-700">Type de chiffrage</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button 
                        onClick={() => handleCreateRoom('fibonacci')}
                        className="p-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left group"
                      >
                        <div className="bg-indigo-100 text-indigo-600 p-3 rounded-xl w-fit mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <RotateCcw className="w-6 h-6" />
                        </div>
                        <h4 className="font-bold text-lg">Fibonacci</h4>
                        <p className="text-sm text-slate-500">0, 1, 2, 3, 5, 8, 13, 21, 34, 55, ?, ☕</p>
                      </button>

                      <button 
                        onClick={() => handleCreateRoom('free')}
                        className="p-6 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left group"
                      >
                        <div className="bg-emerald-100 text-emerald-600 p-3 rounded-xl w-fit mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                          <Plus className="w-6 h-6" />
                        </div>
                        <h4 className="font-bold text-lg">Mode Libre</h4>
                        <p className="text-sm text-slate-500">Chaque personne renseigne le nombre qu'elle souhaite.</p>
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3 text-amber-800 text-sm">
                    <Clock className="w-5 h-5 shrink-0" />
                    <p>La salle sera automatiquement détruite après 30 minutes d'inactivité.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'room' && currentRoom && (
            <motion.div 
              key="room"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                    <Users className="w-4 h-4" />
                    <span>{votes.length} participant{votes.length > 1 ? 's' : ''}</span>
                    <span className="mx-2">•</span>
                    <Clock className="w-4 h-4" />
                    <span>Expire dans {formatDistanceToNow(currentRoom.expiresAt.toDate(), { locale: fr })}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">Salon {currentRoom.code}</h2>
                    <button 
                      onClick={handleShare}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                      title="Partager le code"
                    >
                      <Share2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto">
                  {currentRoom.creatorId === userId && (
                    <>
                      <button 
                        onClick={handleReveal}
                        disabled={currentRoom.revealed || votes.length === 0}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-100"
                      >
                        <Eye className="w-5 h-5" />
                        Révéler
                      </button>
                      <button 
                        onClick={handleReset}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 px-6 rounded-xl transition-all"
                      >
                        <RotateCcw className="w-5 h-5" />
                        Réinitialiser
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  {/* Voting Area */}
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xl font-bold text-slate-800">Votre vote</h3>
                      {myVote && (
                        <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm bg-emerald-50 px-3 py-1 rounded-full">
                          <CheckCircle2 className="w-4 h-4" />
                          Voté
                        </div>
                      )}
                    </div>

                    {currentRoom.votingType === 'fibonacci' ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                          {FIBONACCI_VALUES.map((val) => (
                            <button
                              key={val}
                              onClick={() => handleVote(val)}
                              className={cn(
                                "aspect-[3/4] flex flex-col items-center justify-center rounded-2xl border-2 transition-all text-2xl font-black",
                                myVote?.vote === val 
                                  ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105" 
                                  : "bg-white border-slate-100 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                              )}
                            >
                              {val === '☕' ? <Coffee className="w-8 h-8" /> : val}
                            </button>
                          ))}
                        </div>
                        <button 
                          onClick={() => handleVote('PASS')}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 font-bold transition-all",
                            myVote?.vote === 'PASS'
                              ? "bg-slate-800 border-slate-800 text-white"
                              : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          <SkipForward className="w-5 h-5" />
                          Je passe mon tour
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex gap-4">
                          <input 
                            type="number" 
                            placeholder="Entrez votre valeur..."
                            className="flex-1 px-6 py-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 outline-none text-xl font-bold"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleVote((e.target as HTMLInputElement).value);
                              }
                            }}
                          />
                          <button 
                            onClick={(e) => {
                              const input = (e.currentTarget.previousSibling as HTMLInputElement);
                              handleVote(input.value);
                            }}
                            className="bg-indigo-600 text-white px-8 rounded-2xl font-bold hover:bg-indigo-700 transition-all"
                          >
                            Voter
                          </button>
                        </div>
                        <button 
                          onClick={() => handleVote('PASS')}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 font-bold transition-all",
                            myVote?.vote === 'PASS'
                              ? "bg-slate-800 border-slate-800 text-white"
                              : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          <SkipForward className="w-5 h-5" />
                          Je passe mon tour
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Results Area */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {votes.map((v) => (
                      <motion.div 
                        layout
                        key={v.userId}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={cn(
                          "aspect-[3/4] rounded-2xl border-2 p-4 flex flex-col items-center justify-between transition-all",
                          currentRoom.revealed 
                            ? "bg-white border-indigo-100 shadow-sm" 
                            : "bg-slate-50 border-dashed border-slate-200"
                        )}
                      >
                        <div className="w-full flex justify-between items-start">
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                            {v.userName[0].toUpperCase()}
                          </div>
                          {v.userId === userId && (
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded">Moi</span>
                          )}
                        </div>

                        <div className="text-4xl font-black text-indigo-900">
                          {currentRoom.revealed || v.userId === userId ? (
                            v.vote === '☕' ? <Coffee className="w-10 h-10" /> : 
                            v.vote === 'PASS' ? <SkipForward className="w-10 h-10 text-slate-400" /> :
                            v.vote
                          ) : (
                            <div className="w-12 h-16 bg-slate-200 rounded-lg animate-pulse" />
                          )}
                        </div>

                        <p className="text-sm font-bold text-slate-600 truncate w-full text-center">{v.userName}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Sidebar Stats */}
                <div className="space-y-6">
                  {currentRoom.revealed && votes.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-4"
                    >
                      <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                        Statistiques
                      </h4>
                      <div className="space-y-3">
                        {(() => {
                          const numericVotes = votes
                            .map(v => parseFloat(v.vote))
                            .filter(v => !isNaN(v));
                          
                          const passCount = votes.filter(v => v.vote === 'PASS').length;
                          
                          if (numericVotes.length === 0 && passCount === 0) return <p className="text-sm text-slate-500 italic">Pas de votes.</p>;
                          
                          const avg = numericVotes.length > 0 ? numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length : 0;
                          const sorted = [...numericVotes].sort((a, b) => a - b);
                          const median = sorted.length > 0 
                            ? (sorted.length % 2 === 0 
                                ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
                                : sorted[Math.floor(sorted.length/2)])
                            : 0;

                          return (
                            <>
                              {numericVotes.length > 0 && (
                                <>
                                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                    <span className="text-sm text-slate-600">Moyenne</span>
                                    <span className="text-xl font-black text-indigo-600">{avg.toFixed(1)}</span>
                                  </div>
                                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                    <span className="text-sm text-slate-600">Médiane</span>
                                    <span className="text-xl font-black text-indigo-600">{median}</span>
                                  </div>
                                </>
                              )}
                              {passCount > 0 && (
                                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                                  <span className="text-sm text-slate-600">Passé</span>
                                  <span className="text-xl font-black text-slate-500">{passCount}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}

                  <div className="bg-indigo-900 text-white p-6 rounded-3xl shadow-xl space-y-4">
                    <h4 className="font-bold flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-indigo-300" />
                      Comment ça marche ?
                    </h4>
                    <ul className="text-sm text-indigo-100 space-y-3">
                      <li className="flex gap-2">
                        <span className="font-bold text-indigo-300">1.</span>
                        Chaque membre choisit une carte représentant sa complexité estimée.
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-indigo-300">2.</span>
                        Les votes restent cachés jusqu'à ce que le créateur les révèle.
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-indigo-300">3.</span>
                        Discutez des écarts et réinitialisez pour un nouveau tour si besoin.
                      </li>
                    </ul>
                  </div>

                  {currentRoom.creatorId === userId && (
                    <button 
                      onClick={async () => {
                        if (confirm("Voulez-vous vraiment supprimer cette salle ?")) {
                          await deleteDoc(doc(db, 'rooms', currentRoom.id));
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 text-red-500 hover:text-red-700 font-medium py-2 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Supprimer la salle
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-5xl mx-auto p-6 text-center text-slate-400 text-sm">
        <p>© 2026 Agile Poker • Fibonacci & Planning Poker</p>
      </footer>
    </div>
  );
}
