// check_status.js
import { initializeApp } from 'firebase/app';
import { getFirestore, collectionGroup, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDL1BDF5M78MWd_E35UEz31lXBxbI3hpDE",
  authDomain: "kiranakeeper.firebaseapp.com",
  projectId: "kiranakeeper",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findBotStatus() {
  const inventoryGroupRef = collectionGroup(db, 'inventory');
  const inventorySnap = await getDocs(inventoryGroupRef);
  
  if (inventorySnap.empty) {
    console.log("No inventory found.");
    return;
  }
  
  const userId = inventorySnap.docs[0].ref.path.split('/')[1];
  console.log(`Detected userId: ${userId}`);
  
  const botStatusRef = doc(db, `users/${userId}/bot/status`);
  const statusSnap = await getDoc(botStatusRef);
  
  if (statusSnap.exists()) {
    console.log("Current Bot Status:", JSON.stringify(statusSnap.data(), null, 2));
  } else {
    console.log("Bot status document does not exist.");
  }
}

findBotStatus();
