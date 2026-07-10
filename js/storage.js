/* Tiny localStorage wrapper — all app state persists offline through this. */
class TitanStorage {
  static save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  static load(key, defaultValue) {
    const value = localStorage.getItem(key);
    if (value === null || value === undefined) return defaultValue;
    try {
      return JSON.parse(value);
    } catch (e) {
      return defaultValue;
    }
  }
  static remove(key) {
    localStorage.removeItem(key);
  }
}
