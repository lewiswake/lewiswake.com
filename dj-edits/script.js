document.addEventListener("DOMContentLoaded", () => {
  const contentArea = document.getElementById("content-area");

  // Fetch the data from JSON file
  fetch("data.json")
    .then((response) => response.json())
    .then((data) => {
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

        // Create the section container
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "category-section"; // <--- Added class for spacing

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
    })
    .catch((error) => console.error("Error loading data:", error));
});
