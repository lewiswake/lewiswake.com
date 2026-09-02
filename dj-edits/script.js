document.addEventListener("DOMContentLoaded", async () => {
  const contentArea = document.getElementById("track-list-container");
  const lastUpdatedSpan = document.getElementById("last-updated");

  const totalTracksSpan = document.getElementById("total-tracks-count");

  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json();

    if (data.lastUpdated) {
      lastUpdatedSpan.textContent = data.lastUpdated;
    }

    let totalTracks = 0;

    // Render Categories & Tracks
    data.categories.forEach((category) => {
      totalTracks += category.tracks.length;

      // Sort tracks alphabetically by artist
      category.tracks.sort((a, b) =>
        a.artist.toLowerCase().localeCompare(b.artist.toLowerCase()),
      );

      const sectionId = category.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");

      // Build Section Container
      const section = document.createElement("section");
      section.className = "category-section";
      section.id = sectionId;

      // Build Section Header
      const header = document.createElement("div");
      header.className = "category-header";
      header.innerHTML = `<h2>${category.title} <span class="count-badge">${category.tracks.length}</span></h2><p>${category.description}</p>`;
      section.appendChild(header);

      // Build Track Grid
      const grid = document.createElement("div");
      grid.className = "track-grid";

      category.tracks.forEach((track) => {
        const card = document.createElement("div");
        card.className = "track-card";
        // Combine artist and title for broader search matching
        card.dataset.searchString =
          `${track.artist} ${track.title}`.toLowerCase();

        card.innerHTML = `
          <div class="track-info">
            <span class="track-title">${track.title}</span>
            <span class="track-artist">${track.artist}</span>
          </div>
          <span class="track-bpm">${track.bpm}</span>
        `;
        grid.appendChild(card);
      });

      section.appendChild(grid);
      contentArea.appendChild(section);
    });

    // Fetch successful, tracks rendered.
    if (totalTracksSpan) {
      totalTracksSpan.textContent = totalTracks;
    }
  } catch (err) {
    console.error("Failed to load tracks:", err);
    contentArea.innerHTML = `<div class="empty-state"><h3>Error loading tracks</h3><p>Please try refreshing the page.</p></div>`;
  }
});
