document.addEventListener("DOMContentLoaded", () => {
  const contentArea = document.getElementById("content-area");
  const lastUpdatedSpan = document.getElementById("last-updated-date");
  const tocContainer = document.getElementById("toc");
  const artistFilter = document.getElementById("artist-filter");

  // Fetch the data from JSON file
  fetch("data.json")
    .then((response) => response.json())
    .then((data) => {
      // Set dynamic last updated date
      if (data.lastUpdated) {
        lastUpdatedSpan.textContent = data.lastUpdated;
      }

      // Loop through each category in the JSON
      data.categories.forEach((category) => {
        // Sort tracks alphabetically by artist name
        category.tracks.sort((a, b) => {
          const artistA = a.artist.toLowerCase();
          const artistB = b.artist.toLowerCase();
          if (artistA < artistB) return -1;
          if (artistA > artistB) return 1;
          return 0;
        });

        // Generate a URL-friendly ID for the category anchor
        const sectionId = category.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");

        // Build Table of Contents Link
        const tocLink = document.createElement("a");
        tocLink.href = `#${sectionId}`;
        tocLink.className = "toc-link";
        tocLink.textContent = category.title;
        tocContainer.appendChild(tocLink);

        // Create the section container
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "category-section";
        sectionDiv.id = sectionId; // Add ID for anchor jump

        // Create Header (H2)
        const h2 = document.createElement("h2");
        h2.textContent = category.title;
        sectionDiv.appendChild(h2);

        // Create Description
        const descDiv = document.createElement("div");
        descDiv.className = "section-desc";
        descDiv.textContent = category.description;
        sectionDiv.appendChild(descDiv);

        // Create Glass container
        const glassDiv = document.createElement("div");
        glassDiv.className = "glass";

        // Create List
        const ul = document.createElement("ul");

        // Populate List Items
        category.tracks.forEach((track) => {
          const li = document.createElement("li");
          // Store artist name as a data attribute for easy filtering
          li.dataset.artist = track.artist.toLowerCase();

          // Track Info Wrapper
          const trackInfoDiv = document.createElement("div");
          trackInfoDiv.className = "track-info";

          const songTitleSpan = document.createElement("span");
          songTitleSpan.className = "song-title";
          songTitleSpan.textContent = track.title;

          const artistNameSpan = document.createElement("span");
          artistNameSpan.className = "artist-name";
          artistNameSpan.textContent = track.artist;

          trackInfoDiv.appendChild(songTitleSpan);
          trackInfoDiv.appendChild(artistNameSpan);

          // BPM Badge
          const bpmSpan = document.createElement("span");
          bpmSpan.className = "bpm";
          bpmSpan.textContent = track.bpm;

          // Assemble List Item
          li.appendChild(trackInfoDiv);
          li.appendChild(bpmSpan);

          // Add to List
          ul.appendChild(li);
        });

        // Assemble Section
        glassDiv.appendChild(ul);
        sectionDiv.appendChild(glassDiv);
        contentArea.appendChild(sectionDiv);
      });

      // Implement Live Filter Logic
      artistFilter.addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const sections = document.querySelectorAll(".category-section");

        sections.forEach((section) => {
          let hasVisibleTracks = false;
          const tracks = section.querySelectorAll("li");

          tracks.forEach((track) => {
            const artist = track.dataset.artist;
            if (artist.includes(searchTerm)) {
              track.style.display = "flex"; // Reset to default display
              hasVisibleTracks = true;
            } else {
              track.style.display = "none"; // Hide track
            }
          });

          // Hide the entire section if no tracks match the search
          section.style.display = hasVisibleTracks ? "block" : "none";
        });
      });
    })
    .catch((error) => console.error("Error loading data:", error));
});
