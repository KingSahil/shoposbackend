import { fetchMenuFromFirebase } from './firebase_client.js';

/**
 * Get the current menu from the Website API/Firebase
 * This ensures that every time we call it, we get the freshest data.
 * @returns {Promise<Object>} The menu object
 */
export async function getMenu() {
  // Fallback static menu
  let menu = {
    1: { description: "Amul Milk", price: 50, stock: 0 },
    2: { description: "Apple", price: 20, stock: 10 },
    3: { description: "Sugar", price: 6, stock: 5 },
    4: { description: "Onion", price: 10, stock: 20 },
    5: { description: "Tomato", price: 30, stock: 15 },
  };

  try {
    const fbMenu = await fetchMenuFromFirebase();
    if (fbMenu && Object.keys(fbMenu).length > 0) {
      return fbMenu;
    }
  } catch (e) {
    console.error("Failed to fetch menu from Website API, using fallback static menu.", e);
  }

  return menu;
}
