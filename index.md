---
---

<!--# CIRCLE Group-->
  <p>
    At <strong>CIRCLE</strong>, we aim to <strong>make machines see and perceive the world</strong>—not just to recognize pixels, but to understand the structure, symmetry, and meaning embedded in the physical and abstract world. We explore the frontiers of <strong>perception, learning, and geometry</strong>, blending deep learning with the mathematical elegance of <em>topology</em>, <em>differential geometry</em>, and even <em>quantum theory</em>.
  </p>

  <p>
    Our philosophy is <strong>holistic</strong>: we believe that intelligent systems must be as deeply rooted in <strong>theoretical understanding</strong> as they are in <strong>real-world utility</strong>. We let <em>applications inform learning</em>, and <em>learning theories guide applications</em>. This dual lens is what makes our work both principled and impactful. We are driven by curiosity and a commitment to <strong>open, inclusive, transformative science</strong>.
  </p>

  <h4>Our research spans:</h4>
  <ul>
    <li><strong>3D Computer Vision</strong>: Perceiving structure, motion, and semantics in three-dimensional spaces</li>
    <li><strong>3D/4D Generative Priors</strong>: Learning inductive biases for shape, motion, and time</li>
    <li><strong>Geometric & Topological Deep Learning</strong>: Learning on complex domains: graphs, manifolds, and cell complexes</li>
    <li><strong>Statistical & Topological Learning Theory</strong>: Foundations of robustness, generalization, and expressivity in machine learning</li>
    <li><strong>Quantum Computer Vision</strong>: Novel computational paradigms towards vision and learning</li>
    <li><strong>Generative Models for Biochemistry</strong>: Designing molecules and proteins with symmetry and structure-aware higher-order priors</li>
  </ul>

  <p>
    Join us as we reimagine machine intelligence from the ground up—with <strong>rigor</strong>, <strong>creativity</strong>, and <strong>a relentless curiosity</strong> about the world and how we learn to see it.
  </p>

{% include section.html %}

## Highlights

{% capture text %}

We actively publish at the top venues of computer vision and machine learning, including CVPR, NeurIPS, ICLR, ICCV, ECCV, ICML and 3DV. 

{%
  include button.html
  link="research"
  text="See our publications"
  icon="fa-solid fa-arrow-right"
  flip=true
  style="bare"
%}

{% endcapture %}

{%
  include feature.html
  image="images/research.jpg"
  link="research"
  title="Our Publications"
  text=text
%}

{% capture text %}

We publish in a variety of areas that cross-feed each other, including: 
3D Computer Vision including 3D/4D Generative Priors, Geometric & Topological Deep Learning, Statistical & Topological Learning Theory, Mechanistic Interpretability, Quantum Computer Vision and Generative Models for Biochemistry.

{%
  include button.html
  link="projects"
  text="Browse our projects"
  icon="fa-solid fa-arrow-right"
  flip=true
  style="bare"
%}

{% endcapture %}

{%
  include feature.html
  image="images/photo.jpg"
  link="projects"
  title="Our Projects"
  flip=true
  style="bare"
  text=text
%}

{% capture text %}

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

{%
  include button.html
  link="team"
  text="Meet our team"
  icon="fa-solid fa-arrow-right"
  flip=true
  style="bare"
%}

{% endcapture %}

{%
  include feature.html
  image="images/photo.jpg"
  link="team"
  title="Our Team"
  text=text
%}


{% capture col1 %}
## {% include icon.html icon="fa-solid fa-bullhorn" %}Latest news

  {% assign sorted_news = site.data.news | sort: "date" | reverse %}
    {% for post in sorted_news limit:3 %}
    
  <div class="news-card">
    <div class="news-header">
        <span class="news-title">{{ post.title }}</span>
        <span class="news-date">{% include icon.html icon="fa-regular fa-calendar" %} {{ post.date | date: "%B %d, %Y" }} </span>
    </div>
    <div class="news-description">
        {{ post.description }} 
            {% if post.url %}
            <a href="{{ post.url }}" target="_blank">More...</a>
            {% endif %}
    </div>
  </div>

    {% endfor %}  
  
{%
  include button.html
  link="news"
  text="Read all news"
  icon="fa-solid fa-arrow-right"
  flip=true
  align=left

%}

{% endcapture %}

{% include section.html %}

#### Our funders

{% capture col1 %}
<img src="images/funders/imperial.svg">
{% endcapture %}

{% capture col2 %}
<img src="images/funders/ukri.svg">
{% endcapture %}

{% capture col3 %}
<img src="images/funders/RS.svg">
{% endcapture %}

{% capture col4 %}
<img src="images/funders/meta.svg">
{% endcapture %}

{% include cols.html col1=col1 col2=col2 col3=col3 col4=col4%}
