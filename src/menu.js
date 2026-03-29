import { fetchMenuFromFirebase } from './firebase_client.js';
// Force reload to fetch with updated rules
let menu = {
  1: {
    description: "Amul Milk",
    price: 50,
  },
  2: {
    description: "Apple",
    price: 20,
  },
  3: {
    description: "Sugar",
    price: 6,
  },
  4: {
    description: "Onion",
    price: 10,
  },
  5: {
    description: "Tomato",
    price: 30,
  },
};

try {
  const fbMenu = await fetchMenuFromFirebase();
  if (fbMenu && Object.keys(fbMenu).length > 0) {
    menu = fbMenu;
    console.log(`✅ Loaded ${Object.keys(menu).length} items from Website inventory API:`, Object.values(menu).map(i => i.description).join(', '));
  } else {
    console.log("Using fallback static menu items.");
  }
} catch (e) {
  console.error("Failed to fetch menu from Firebase, using fallback static menu.", e);
}

export async function getMenu() {
  try {
    const fbMenu = await fetchMenuFromFirebase();
    if (fbMenu && Object.keys(fbMenu).length > 0) {
      menu = fbMenu;
    }
  } catch (e) {
    console.error("Failed to refresh menu from Firebase, using cached menu.", e);
  }

  return menu;
}

export { menu };
