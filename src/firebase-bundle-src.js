// Firebase bundle source - this gets compiled into lib/firebase-bundle.js
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCredential, signOut, onAuthStateChanged, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit } from 'firebase/firestore';

// Expose on globalThis so extension scripts can access them
globalThis.firebase = {
  initializeApp,
  getAnalytics,
  isSupported,
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit
};
